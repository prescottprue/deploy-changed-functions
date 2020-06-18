import * as core from '@actions/core';
import isEqual from 'lodash/isEqual';
import { exec } from '@actions/exec';
import {
  loadFirebaseJson,
  createLocalCacheFolder,
  onlyChangedFunctions,
} from './utils';
import { downloadCache, writeCache, checkForDiff } from './actions';

/**
 * Run deploy-changed-functions logic
 */
export async function run(): Promise<void> {
  const cacheFolder = core.getInput('cache-folder');
  const folderSuffix = cacheFolder?.split('/').pop();
  const localFolder = core.getInput('local-folder');
  const projectId = core.getInput('project_id');
  const storageBucket = core.getInput('storage-bucket');
  const storageBaseUrl = `gs://${storageBucket || projectId}.appspot.com`;

  const { GITHUB_WORKSPACE } = process.env;
  if (!GITHUB_WORKSPACE) {
    core.setFailed('Missing GITHUB_WORKSPACE!');
  }

  try {
    // Create local folder for cache
    const localCacheFolder = `${GITHUB_WORKSPACE}/${localFolder}`;
    await createLocalCacheFolder(localCacheFolder);
    core.info(`Created local cache folder "${localCacheFolder}"`);

    // Load functions settings from firebase.json
    const firebaseJson = await loadFirebaseJson();
    core.info('Successfully loaded firebase.json');

    const functionsFolderWithoutPrefix =
      firebaseJson.functions?.source || core.getInput('functions-folder');
    const functionsFolder = `${GITHUB_WORKSPACE}/${functionsFolderWithoutPrefix}`;

    // Download Functions cache from Cloud Storage
    await downloadCache(cacheFolder, { localCacheFolder, storageBaseUrl });
    // TODO: Handle error downloading due to folder not existing
    core.info('Successfully downloaded functions cache');
    // const globber = await glob.create(`${functionsFolder}/*`);

    // TODO: Use all files which are not ignored in functions folder as globals
    const topLevelFilesInput: string = core.getInput('global-paths');
    const topLevelFilesToCheck: string[] =
      topLevelFilesInput?.split(',').filter(Boolean) || [];
    const deployArgs = ['deploy', '--only'];

    // Check for changes in top level files
    if (topLevelFilesToCheck?.length) {
      const listOfChangedTopLevelFiles = await checkForDiff(
        topLevelFilesToCheck,
        {
          localCacheFolder: `${localCacheFolder}/${folderSuffix}`,
          functionsFolder,
        },
      );
      const topLevelFilesChanged = !!listOfChangedTopLevelFiles.filter(Boolean)
        .length;
      core.info(
        `List of changed top level files: ${listOfChangedTopLevelFiles.join(
          '\n',
        )}`,
      );
      core.info('Successfully checked for changes in top level files');
      const cachedFirebaseJson = await loadFirebaseJson(localCacheFolder);
      const functionsConfigsChanged =
        firebaseJson?.functions &&
        !isEqual(firebaseJson.functions, cachedFirebaseJson.functions);
      if (topLevelFilesChanged || functionsConfigsChanged) {
        deployArgs.push('functions', '--force');
        const message = topLevelFilesChanged
          ? 'Global files changed'
          : 'firebase.json functions settings changed';
        core.info(`${message}, deploying all functions`);
      } else {
        core.info('No global files changed in functions');
      }
    } else {
      core.info('No global files to check');
    }

    core.info('Checking for changes in src folder');

    // Check for change in files within src folder
    // TODO: Switch this to checking dist so that babel config is handled
    const listOfChangedFiles = await checkForDiff(['src'], {
      localCacheFolder: `${localCacheFolder}/${folderSuffix}`,
      functionsFolder,
    });
    core.info(`List of changed source files: ${listOfChangedFiles.join('\n')}`);
    const changedFunctionsOnlyCommand = onlyChangedFunctions(
      listOfChangedFiles,
    );
    if (changedFunctionsOnlyCommand?.length) {
      deployArgs.push(changedFunctionsOnlyCommand);
    } else {
      core.info('No functions source code changed');
    }

    // TODO: Handle deleting of functions during update by checking if folder exists in src/dist
    if (deployArgs?.length > 2) {
      core.info(`Calling deploy with args: ${deployArgs.join(' ')}`);
      const token = core.getInput('token');
      // Exit if token is missing
      if (!token && !process.env.FIREBASE_TOKEN) {
        core.setFailed(
          'token input or FIREBASE_TOKEN environment variable are required',
        );
      }
      // Add deploy token to arguments
      deployArgs.push('--token', process.env.FIREBASE_TOKEN || token);
      let deployCommandOutput = '';
      // Call deploy command with listener for output
      const options = {
        listeners: {
          stdout: (data: Buffer) => {
            deployCommandOutput += data.toString();
          },
        },
      };
      const deployExitCode = await exec(
        'firebase',
        deployArgs.concat(['--project', projectId]),
        options,
      );

      // Attempt redeploy if exit code is not 0
      if (deployExitCode) {
        core.info(
          `Deploy failed, attempting to parse redeploy message from output`,
        );
        if (deployCommandOutput) {
          const searchResults = /To try redeploying those functions, run:\n\s*firebase\s(.*)/g.exec(
            deployCommandOutput,
          );
          const newDeployCommand = searchResults && searchResults[1];
          await exec('firebase', newDeployCommand?.split(' '));
        }
      }
    }

    // Re-upload files to cache
    await writeCache(topLevelFilesToCheck, { functionsFolder, storageBaseUrl });
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
