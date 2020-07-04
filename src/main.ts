import * as core from '@actions/core';
import * as io from '@actions/io';
import { exec } from '@actions/exec';
import {
  loadFirebaseJson,
  createLocalCacheFolder,
  onlyChangedFunctions,
} from './utils';
import {
  downloadCache,
  writeCache,
  checkForDiff,
  checkForTopLevelChanges,
} from './actions';

const DEFAULT_FUNCTIONS_FOLDER = 'functions';
const DEFAULT_STORAGE_FOLDER = 'functions_deploy_cache';
const DEFAULT_LOCAL_CACHE_FOLDER = 'local_functions_cache';

/**
 * Run deploy-changed-functions logic
 */
export default async function run(): Promise<void> {
  const { GITHUB_WORKSPACE } = process.env;

  const projectId = core.getInput('project-id');
  if (!projectId) {
    core.setFailed('Missing required input "project-id"');
  }

  const firebaseCiToken = core.getInput('token');
  // Exit if token is missing
  if (!firebaseCiToken) {
    core.setFailed('Missing required input "token"');
  }

  const localFolder =
    core.getInput('local-folder') || DEFAULT_LOCAL_CACHE_FOLDER;
  const storageBucket = core.getInput('storage-bucket');
  const storageBaseUrl = `gs://${storageBucket || projectId}.appspot.com`;

  try {
    // Create local folder for cache
    const localCacheFolder = `${GITHUB_WORKSPACE}/${localFolder}`;
    await createLocalCacheFolder(localCacheFolder);
    core.info(`Created local cache folder "${localCacheFolder}"`);

    const cacheFolder = core.getInput('cache-folder') || DEFAULT_STORAGE_FOLDER;
    const folderSuffix = cacheFolder?.split('/').pop();

    // Download Functions cache from Cloud Storage
    await downloadCache(cacheFolder, { localCacheFolder, storageBaseUrl });
    core.info('Successfully downloaded Cloud Functions cache');

    // Get list of "global" files which cause a full functions deployment
    const topLevelFilesInput: string = core.getInput('global-paths');
    const topLevelFilesToCheck: string[] =
      topLevelFilesInput?.split(',').filter(Boolean) || [];

    // Load functions settings from firebase.json (undefined if file does not exist)
    const firebaseJson = await loadFirebaseJson();
    core.info('Successfully loaded firebase.json');

    // Get path for functions folder (priority: input -> firebase.json functions source -> 'functions')
    const functionsFolderInput = core.getInput('functions-folder');
    const functionsFolder = `${GITHUB_WORKSPACE}/${
      functionsFolderInput ||
      firebaseJson?.functions?.source ||
      DEFAULT_FUNCTIONS_FOLDER
    }`;

    // Check files/folders which can cause a full functions deployment
    const topLevelFileChanged = await checkForTopLevelChanges(
      topLevelFilesToCheck,
      {
        localCacheFolder: `${localCacheFolder}/${folderSuffix}`,
        functionsFolder,
        firebaseJson,
      },
    );
    const deployArgs = ['deploy', '--only'];
    if (topLevelFileChanged) {
      deployArgs.push('functions');
    }

    core.info('Checking for changes in Cloud Functions folder');

    // Check for change in files within src folder
    // TODO: Switch this to checking dist so that babel config is handled
    const listOfChangedFiles = await checkForDiff(['src'], {
      localCacheFolder: `${localCacheFolder}/${folderSuffix}`,
      functionsFolder,
    });
    core.info(
      `List of changed function files: ${listOfChangedFiles.join('\n')}`,
    );
    const changedFunctionsOnlyCommand = onlyChangedFunctions(
      listOfChangedFiles,
    );

    // TODO: Handle deleting of functions during update by checking if folder exists in src/dist
    // Add list of changed functions to deploy command (i.e. functions:myFunc)
    if (changedFunctionsOnlyCommand?.length) {
      deployArgs.push(changedFunctionsOnlyCommand);
    } else {
      core.info('No functions source code changed');
    }

    if (deployArgs?.length > 2) {
      const skipDeploy = core.getInput('skip-deploy');
      if (skipDeploy) {
        core.info(
          `Skipping deploy, would be using args: ${deployArgs.join(' ')}`,
        );
      } else {
        core.info(`Calling deploy with args: ${deployArgs.join(' ')}`);
        let deployCommandOutput = '';
        const firebaseToolsPath = await io.which('firebase');

        // Call deploy command with listener for output (so that in case of failure,
        // it can be parsed for a list of functions which must be re-deployed)
        const deployExitCode = await exec(
          firebaseToolsPath,
          deployArgs.concat(['--project', projectId]),
          {
            listeners: {
              stdout: (data: Buffer) => {
                deployCommandOutput += data.toString();
              },
            },
            env: {
              FIREBASE_TOKEN: firebaseCiToken,
            },
          },
        );

        // Attempt re-deploy if first deploy was not successful
        // Command is parsed from stdout of initial deploy command
        if (deployExitCode) {
          core.info(
            `Deploy failed, attempting to parse re-deploy message from output...`,
          );
          if (deployCommandOutput) {
            // Get functions deploy commands from output of original deploy command
            const searchResults = /To try redeploying those functions, run:\n\s*firebase\s(.*)/g.exec(
              deployCommandOutput,
            );
            const newDeployCommand = searchResults && searchResults[1];
            await exec(firebaseToolsPath, newDeployCommand?.split(' '));
          }
        }
      }
    }

    const functionsSrcFolder = `${GITHUB_WORKSPACE}/src`;

    // Re-upload files to cache
    const listOfFilesToUpload = [...topLevelFilesToCheck, functionsSrcFolder];
    if (firebaseJson) {
      listOfFilesToUpload.push(`${GITHUB_WORKSPACE}/firebase.json`);
    }
    await writeCache(listOfFilesToUpload, { functionsFolder, storageBaseUrl });
  } catch (error) {
    core.setFailed(error.message);
  }
}
