import * as core from '@actions/core';
import { promises as fs, existsSync } from 'fs';
import exec from '@actions/exec';
import path from 'path';

// -m - parallelize on multiple "machines" (i.e. processes)
// -q - quiet
const gsutilDefaultArgs = ['-m', '-q'];

interface DiffOptions {
  functionsFolder: string;
  localCacheFolder: string;
}

/**
 * @param listOfFilesToDiff - List of files to diff
 * @param options - Options object
 * @returns Whether or not there were changes in the listed files
 */
async function checkForDiff(
  listOfFilesToDiff: string[],
  options: DiffOptions,
): Promise<string[]> {
  const { localCacheFolder, functionsFolder } = options;
  // Check for change in files
  // TODO: Load ignore settings from functions.ignore of firebase.json
  // TODO: Include changes to firebase.json
  try {
    // TODO: Look into piping a list of files into diff to get a single diff result
    const pathsToIgnoreInput: string = core.getInput('ignore');
    const pathsToIgnore: string[] = pathsToIgnoreInput?.split(',') || [];
    const resultsFromMultipleDiffs = await Promise.all(
      listOfFilesToDiff.map(async (topLevelPath) => {
        let diffResultsBeforeTrim = '';
        const options = {
          listeners: {
            stdout: (data: Buffer) => {
              diffResultsBeforeTrim += data.toString();
            },
          },
        };
        // TODO: only ignore files when pointing to a folder
        // Ignore files based on settings
        const diffBaseArgs = ['-Nqr', '-w', '-B'];
        if (pathsToIgnore?.length) {
          pathsToIgnore.forEach((globToIgnore) => {
            diffBaseArgs.push('-x', globToIgnore);
          });
        }
        try {
          await exec.exec(
            'diff',
            ['-Nqr', '-w', '-B'].concat([
              `${functionsFolder}/${topLevelPath}`,
              `${localCacheFolder}/${topLevelPath}`,
            ]),
            options,
          );
        } catch (error) {
          throw new Error(
            `Error checking for diff for file "${topLevelPath}": ${error.message}`,
          );
        }
        return diffResultsBeforeTrim;
      }),
    );
    // TODO: Improve filtering to match awk
    return resultsFromMultipleDiffs;
  } catch (error) {
    // TODO: Handle error downloading due to folder not existing
    throw new Error(`Error checking for file diff: ${error.message}`);
  }
}

interface WriteSettings {
  functionsFolder: string;
  storageBaseUrl: string;
}

/**
 * @param filesToUpload - List of files paths to upload
 * @param settings - Settings object
 */
async function writeCache(
  filesToUpload: string[],
  settings: WriteSettings,
): Promise<any> {
  const { functionsFolder, storageBaseUrl } = settings;
  // TODO: Look into creating a list of files and piping them to the stdin of gsutil
  try {
    await Promise.all(
      filesToUpload.map(async (topLevelPath) => {
        const stat = await fs.lstat(`${process.cwd()}/${topLevelPath}`);
        const copyArgs = gsutilDefaultArgs.concat(['cp']);
        const isDirectory = stat.isDirectory();
        if (isDirectory) {
          copyArgs.push('-r');
        }

        return exec.exec(
          'gsutil',
          copyArgs.concat([
            `${functionsFolder}/${topLevelPath}`,
            `${storageBaseUrl}/${isDirectory ? '' : topLevelPath}`,
          ]),
        );
      }),
    );
  } catch (err) {
    throw new Error('Error writing functions cache');
  }
}

/**
 * @param cacheFolder - Cache folder
 * @param storageBaseUrl - Base URL for storage
 */
async function downloadCache(
  cacheFolder: string,
  storageBaseUrl: string,
): Promise<any> {
  // TODO: Look into creating a list of files and piping them to the stdin of gsutil
  try {
    await exec.exec(
      'gsutil',
      gsutilDefaultArgs.concat([
        'cp',
        '-r',
        `${storageBaseUrl}/${cacheFolder}`,
        `${storageBaseUrl}/`,
      ]),
    );
  } catch (error) {
    throw new Error(`Error downloading local cache: ${error.message}`);
  }
}

interface FunctionsFirebaseSetting {
  source?: string;
  ignore?: string[];
  predeploy?: string[];
}

interface FirebaseJson {
  functions?: FunctionsFirebaseSetting;
}

/**
 * Load firebase.json from root of project
 * @returns {object} Contents of firebase.json
 */
async function loadFirebaseJson(): Promise<FirebaseJson> {
  const workspace = process.env.GITHUB_WORKSPACE;
  if (!workspace) {
    throw new Error('Missing GITHUB_WORKSPACE!');
  }
  const firebaseJsonPath = `${workspace}/firebase.json`;
  if (!existsSync(firebaseJsonPath)) {
    core.warning(`firebase.json not found at path: "${firebaseJsonPath}"`);
    return {};
  }
  let firebaseJsonStr: string;
  try {
    const firebaseJsonBuffer = await fs.readFile(firebaseJsonPath);
    firebaseJsonStr = firebaseJsonBuffer.toString();
  } catch (err) {
    throw new Error('Error loading firebase.json');
  }
  try {
    return JSON.parse(firebaseJsonStr);
  } catch (err) {
    throw new Error('Error parsing firebase.json, confirm it is valid JSON');
  }
}

/**
 * @param localFolder - Local cache folder path
 */
async function createLocalCacheFolder(localFolder: string): Promise<void> {
  try {
    // Create local folder for cache
    await exec.exec('mkdir', ['-p', localFolder]);
  } catch (error) {
    throw new Error(`Error creating local cache folder: ${error}`);
  }
}

/**
 * @param changedFiles - List of changed files
 * @returns List of changed functions
 */
function onlyChangedFunctions(changedFiles: string[]): string | null {
  // TODO: Filter list of changed files
  const inputLines = changedFiles.filter(Boolean);
  const foldersToIgnore = ['utils', 'constants'];

  const inputPathNames = inputLines.map((currentFilePath) =>
    path.basename(path.dirname(currentFilePath)),
  );
  const inputIncludesIgnoredPaths = inputPathNames.find((pathName) =>
    foldersToIgnore.includes(pathName),
  );
  // Deploy all functions if ignored paths are
  if (inputIncludesIgnoredPaths) {
    return 'functions';
  }

  const deployPathNames = inputPathNames.filter(
    (folderPath) => !foldersToIgnore.includes(folderPath),
  );
  const uniqueDeployPathNames = [...new Set(deployPathNames)];

  // Skip deploying of functions if nothing changed
  if (!uniqueDeployPathNames.length) {
    // console.log('firebase deploy --except functions')
    return null;
  }
  // log deploy command
  const functionsStrings = uniqueDeployPathNames
    .map((pathName) => `functions:${pathName}`)
    .join(',');
  return functionsStrings;
}

/**
 *
 */
export async function run(): Promise<void> {
  const cacheFolder = core.getInput('cache-folder');
  const folderSuffix = cacheFolder?.split('/').pop();
  const localFolder = core.getInput('local-folder');
  const projectId = core.getInput('project_id');
  const storageBucket = core.getInput('storage-bucket');
  const storageBaseUrl = `gs://${storageBucket || projectId}.appspot.com`;

  try {
    // Create local folder for cache
    await createLocalCacheFolder(localFolder);
    core.info('Created local cache folder');

    // Load functions settings from firebase.json
    const firebaseJson = await loadFirebaseJson();
    core.info('Successfully loaded firebase.json');

    // Download Functions cache from Cloud Storage
    await downloadCache(cacheFolder, storageBaseUrl);
    // TODO: Handle error downloading due to folder not existing
    core.info('Successfully downloaded functions cache');

    const functionsFolder =
      firebaseJson.functions?.source || core.getInput('functions-folder');

    // TODO: Use all files which are not ignored in functions folder as globals
    const topLevelFilesInput: string = core.getInput('global-paths');
    const topLevelFilesToCheck: string[] = topLevelFilesInput?.split(',') || [];
    const deployArgs = ['deploy', '--only'];

    // Check for changes in top level files
    if (topLevelFilesToCheck?.length) {
      const listOfChangedTopLevelFiles = await checkForDiff(
        topLevelFilesToCheck,
        {
          localCacheFolder: `${localFolder}/${folderSuffix}`,
          functionsFolder,
        },
      );
      const topLevelFilesChanged = !!listOfChangedTopLevelFiles.filter(Boolean)
        .length;
      core.info('Successfully checked for changes');
      if (topLevelFilesChanged) {
        deployArgs.push('functions', '--force');
        core.info('Top level files changed, deploying all functions');
      } else {
        core.info('No top level files changed in functions');
      }
    }

    // Check for change in files within src folder
    const listOfChangedFiles = await checkForDiff(topLevelFilesToCheck, {
      localCacheFolder: `${localFolder}/${folderSuffix}`,
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

    if (deployArgs?.length > 2) {
      // Call deploy command
      await exec.exec('firebase', deployArgs);
    }

    // Re-upload files to cache
    await writeCache(topLevelFilesToCheck, { functionsFolder, storageBaseUrl });
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
