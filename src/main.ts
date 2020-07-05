import {
  info,
  getInput,
  setFailed,
  setOutput,
  addPath,
  debug,
} from '@actions/core';
import { exec } from '@actions/exec';
import * as toolCache from '@actions/tool-cache';
import { which } from '@actions/io';
// import { promises as fs } from 'fs';
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

interface RunCommandOptions {
  failOnStdErr?: boolean;
  env?: any;
}

/**
 * @param command
 * @param args
 * @param options
 */
async function runCommandWithOutput(
  command: string,
  args: string[],
  options?: RunCommandOptions,
) {
  console.log('command "%s"', command);
  debug(`parsed command: ${args.join(' ')}`);

  const toolPath = await which(command, true);
  debug(`found command "${toolPath}"`);
  debug(`with arguments ${args.slice(1).join(' ')}`);

  const argsString = args.join(' ');
  debug(`running ${toolPath} ${argsString}`);
  debug('without waiting for the promise to resolve');
  let commandOutput = '';
  try {
    await exec(toolPath, args, {
      listeners: {
        stdout: (data: Buffer) => {
          commandOutput += data.toString();
        },
      },
      env: options?.env,
      failOnStdErr: options?.failOnStdErr || true,
      // cwd: GITHUB_WORKSPACE,
    });
  } catch (err) {
    info(`Non 0 exit code for command "${command} ${argsString}"`);
  }
  debug(`command output ${commandOutput}`);
  return commandOutput;
}

/**
 * Run deploy-changed-functions logic
 */
export default async function run(): Promise<void> {
  const { GITHUB_WORKSPACE } = process.env;

  const projectId = getInput('project-id');
  if (!projectId) {
    setFailed('Missing required input "project-id"');
  }

  const firebaseCiToken = getInput('token');
  // Exit if token is missing
  if (!firebaseCiToken) {
    setFailed('Missing required input "token"');
  }

  const localFolder = getInput('local-folder') || DEFAULT_LOCAL_CACHE_FOLDER;
  const storageBucket = getInput('storage-bucket');
  const storageBaseUrl = `gs://${storageBucket || projectId}.appspot.com`;

  try {
    // Create local folder for cache
    const localCacheFolder = `${GITHUB_WORKSPACE}/${localFolder}`;
    await createLocalCacheFolder(localCacheFolder);
    info(`Created local cache folder "${localCacheFolder}"`);

    const cacheFolder = getInput('cache-folder') || DEFAULT_STORAGE_FOLDER;
    const folderSuffix = cacheFolder?.split('/').pop();

    // Download Functions cache from Cloud Storage
    await downloadCache(cacheFolder, { localCacheFolder, storageBaseUrl });
    info('Successfully downloaded Cloud Functions cache');

    // Get list of "global" files which cause a full functions deployment
    const topLevelFilesInput: string = getInput('global-paths');
    const topLevelFilesToCheck: string[] =
      topLevelFilesInput?.split(',').filter(Boolean) || [];

    // Load functions settings from firebase.json (undefined if file does not exist)
    const firebaseJson = await loadFirebaseJson();
    info('Successfully loaded firebase.json');

    // Get path for functions folder (priority: input -> firebase.json functions source -> 'functions')
    const functionsFolderInput = getInput('functions-folder');
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

    info('Checking for changes in Cloud Functions folder');

    // Check for change in files within src folder
    // TODO: Switch this to checking dist so that babel config is handled
    const listOfChangedFiles = await checkForDiff(['src'], {
      localCacheFolder: `${localCacheFolder}/${folderSuffix}`,
      functionsFolder,
    });
    const changedFunctionsOnlyCommand = onlyChangedFunctions(
      listOfChangedFiles,
    );

    // TODO: Handle deleting of functions during update by checking if folder exists in src/dist
    // Add list of changed functions to deploy command (i.e. functions:myFunc)
    if (changedFunctionsOnlyCommand) {
      deployArgs.push(changedFunctionsOnlyCommand);
    } else {
      info('No functions source code changed');
    }

    if (deployArgs?.length > 2) {
      const skipDeploy = getInput('skip-deploy');
      if (skipDeploy === 'true') {
        info(
          `Skipping deploy, deploy command would be "firebase ${deployArgs.join(
            ' ',
          )}"`,
        );
      } else {
        info(`Calling deploy with args: ${deployArgs.join(' ')}`);
        const nodePath = toolCache.find('node', '10.x');
        // const firebaseBinPath = `${GITHUB_WORKSPACE}/node_modules/.bin/firebase`;

        info(`node path: ${nodePath}`);
        addPath(nodePath);
        info(`added node path to path`);

        // Downloading Firebase binary
        const firebaseBinaryPath = `${GITHUB_WORKSPACE}/firebase_bin`;
        info(`Downloading firebase binary`);
        await exec('curl', [
          '-Lo',
          firebaseBinaryPath,
          'https://firebase.tools/bin/linux/v8.4.3',
        ]);
        info(`Downloaded firebase binary, making executable`);
        await exec('chmod', ['+x', firebaseBinaryPath]);
        info(`Chmod successful, adding to cache dir`);
        // const cachedPath = await toolCache.cacheDir(
        //   firebaseBinaryPath,
        //   'firebase',
        //   '8.4.3',
        // );
        // info(`Added firebase binary to cache dir, adding cache dir to path`);
        // addPath(cachedPath);
        // addPath(firebaseBinaryPath);
        // info(`Added firebase binary to path`);

        // Get yarn bin to find firebase command
        // const untrimmedNpmBin = await runCommandWithOutput('npm', ['bin']);
        // info(`Untrimmed yarn bin: ${untrimmedNpmBin}`);
        // const npmBinPath = untrimmedNpmBin.replace('\n', '');
        // info(`Yarn bin: ${npmBinPath}`);
        // const firebaseCommand = `${__dirname}/call_fb`;
        // info(`Command with bin path: ${firebaseCommand}`);
        // info(`Running ls on npm bin path`);
        // await exec('ls', [npmBinPath]);
        // info(`Calling firebase through shell`);
        // SHeebang mod
        // const nodeFullPath = `${nodePath}/bin/node`;
        // const firebasePath = `${GITHUB_WORKSPACE}/node_modules/.bin/firebase`;
        // above was also used in execs
        // const binaryBuffer = await fs.readFile(firebasePath);
        // const binaryStr = binaryBuffer.toString();
        // const modifiedFile = binaryStr.replace(
        //   '#!/usr/bin/env node',
        //   `#!${nodeFullPath} `,
        // );
        // info(`modified file: ${modifiedFile}`);
        // await fs.writeFile(firebasePath, modifiedFile);
        // info(`Write file called`);
        // addPath(firebasePath);
        // info(`Firebase path loaded: ${firebasePath}`);
        // const npxPath = await which('npx');
        // info(`npx path: ${npxPath}`);
        // addPath(nodeDirectory);

        // const whichFirebase = await which('firebase');
        // info(`firebase which path: ${whichFirebase}`);
        setOutput('only-command', changedFunctionsOnlyCommand);
        let deployCommandOutput = '';
        info(`process env path: ${process.env.PATH}`);
        if (!process.env.PATH) {
          info(`process env path not found, setting`);
          addPath(firebaseBinaryPath);
          info(`set path in process env`);
        }
        // const cwd = homedir();
        // Call deploy command with listener for output (so that in case of failure,
        // it can be parsed for a list of functions which must be re-deployed)
        const deployExitCode = await exec(
          firebaseBinaryPath,
          [...deployArgs, '--project', projectId],
          {
            listeners: {
              stdout: (data: Buffer) => {
                deployCommandOutput += data.toString();
              },
            },
            env: {
              FIREBASE_TOKEN: firebaseCiToken,
            },
            failOnStdErr: false,
            // cwd: GITHUB_WORKSPACE,
          },
        );

        // Attempt re-deploy if first deploy was not successful
        // Command is parsed from stdout of initial deploy command
        if (deployExitCode) {
          info(
            `Deploy failed, attempting to parse re-deploy message from output...`,
          );
          if (deployCommandOutput) {
            // Get functions deploy commands from output of original deploy command
            const searchResults = /To try redeploying those functions, run:\n\s*firebase\s(.*)/g.exec(
              deployCommandOutput,
            );
            const newDeployCommand = searchResults && searchResults[1];
            let secondDeployOutput = '';
            const secondDeployExitCode = await exec(
              firebaseBinaryPath,
              [...(newDeployCommand?.split(' ') || [])],
              {
                listeners: {
                  stdout: (data: Buffer) => {
                    secondDeployOutput += data.toString();
                  },
                },
                env: {
                  FIREBASE_TOKEN: firebaseCiToken,
                },
                // cwd: GITHUB_WORKSPACE,
                failOnStdErr: false,
              },
            );
            if (secondDeployExitCode) {
              setFailed(`Redeploying failed:\n ${secondDeployOutput}`);
            }
          }
        }
      }
    }

    // Re-upload files to cache
    const listOfFilesToUpload = [...topLevelFilesToCheck, 'src'];

    await writeCache(listOfFilesToUpload, {
      functionsFolder,
      storagePath: `${storageBaseUrl}/${cacheFolder}`,
      firebaseJson,
    });
  } catch (error) {
    setFailed(error.message);
  }
}
