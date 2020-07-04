import { info, getInput } from '@actions/core';
import isEqual from 'lodash/isEqual';
import { exec } from '@actions/exec';
import { mkdirP } from '@actions/io';
import { promises as fs, existsSync } from 'fs';
import { loadFirebaseJson } from './utils';

// -m - parallelize on multiple "machines" (i.e. processes)
// -q - quiet
const gsutilDefaultArgs = ['-m'];

interface DiffOptions {
  functionsFolder: string;
  localCacheFolder: string;
}

/**
 * @param listOfFilesToDiff - List of files to diff
 * @param options - Options object
 * @returns Whether or not there were changes in the listed files
 */
export async function checkForDiff(
  listOfFilesToDiff: string[],
  options: DiffOptions,
): Promise<string[]> {
  const { localCacheFolder, functionsFolder } = options;
  // Check for change in files
  // TODO: Load ignore settings from functions.ignore of firebase.json
  // TODO: Include changes to firebase.json
  info(
    `Diffing files between paths: "${functionsFolder}" and "${localCacheFolder}"`,
  );
  // TODO: Look into piping a list of files into diff to get a single diff result
  const pathsToIgnoreInput: string = getInput('ignore');
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
        // Run diff command to check for differences between cache and local code
        await exec(
          'diff',
          diffBaseArgs.concat([
            `${functionsFolder}/${topLevelPath}`,
            `${localCacheFolder}/${topLevelPath}`,
          ]),
          options,
        );
      } catch (error) {
        throw new Error(
          `Error checking for diff for path "${topLevelPath}": ${error.message}`,
        );
      }
      return diffResultsBeforeTrim;
    }),
  );
  // TODO: Improve filtering to match awk
  return resultsFromMultipleDiffs;
}

interface CheckTopLevelChangesSettings {
  localCacheFolder: string;
  functionsFolder: string;
  firebaseJson?: FirebaseJson;
}

/**
 * @param topLevelFilesToCheck - List of files to check
 * @param settings - Settings
 * @returns List of files that changed
 */
export async function checkForTopLevelChanges(
  topLevelFilesToCheck: string[],
  settings: CheckTopLevelChangesSettings,
): Promise<boolean> {
  const { localCacheFolder, firebaseJson, functionsFolder } = settings;
  // TODO: Use all files which are not ignored in functions folder as globals

  // Check functions settings in firebase.json
  if (firebaseJson) {
    info('Checking for changes in firebase.json');
    const cachedFirebaseJson = await loadFirebaseJson(localCacheFolder);
    const functionsConfigsChanged = !isEqual(
      firebaseJson?.functions,
      cachedFirebaseJson?.functions,
    );
    if (functionsConfigsChanged) {
      info('firebase.json functions settings changed, deploying all functions');
      return true;
    }
  }

  // Check for changes in global files
  if (topLevelFilesToCheck?.length) {
    const listOfChangedTopLevelFiles = await checkForDiff(
      topLevelFilesToCheck,
      {
        localCacheFolder,
        functionsFolder,
      },
    );
    const topLevelFilesChanged = !!listOfChangedTopLevelFiles.filter(Boolean)
      .length;
    info(
      `List of changed top level files: ${listOfChangedTopLevelFiles.join(
        '\n',
      )}`,
    );
    if (topLevelFilesChanged) {
      info(`Global files changed, deploying all functions`);
      return true;
    }
    info('No global files changed in functions');
  } else {
    info('No global files to check');
  }
  return false;
}

interface WriteCacheSettings {
  functionsFolder: string;
  storagePath: string;
  firebaseJson: FirebaseJson | undefined;
}

/**
 * @param filesToUpload - List of files paths to upload
 * @param settings - Settings object
 */
export async function writeCache(
  filesToUpload: string[],
  settings: WriteCacheSettings,
): Promise<any> {
  const { functionsFolder, storagePath } = settings;
  const copyArgs = gsutilDefaultArgs.concat(['cp']);

  // Upload firebase.json if it exists locally
  if (settings?.firebaseJson) {
    try {
      await exec(
        'gsutil',
        copyArgs.concat([
          `${process.env.GITHUB_WORKSPACE}/firebase.json`,
          `${storagePath}/firebase.json`,
        ]),
      );
    } catch (error) {
      throw new Error(`Error uploading functions cache: ${error.message}`);
    }
  }

  // TODO: Look into creating a list of files and piping them to the stdin of gsutil
  // Upload all other files
  try {
    await Promise.all(
      filesToUpload.map(async (topLevelPath) => {
        if (!existsSync(topLevelPath)) {
          return null;
        }
        const stat = await fs.lstat(topLevelPath);
        const isDirectory = stat.isDirectory();
        if (isDirectory) {
          copyArgs.push('-r');
        }

        return exec(
          'gsutil',
          copyArgs.concat([
            `${functionsFolder}/${topLevelPath}`,
            `${storagePath}/${isDirectory ? '' : topLevelPath}`,
          ]),
        );
      }),
    );
  } catch (error) {
    throw new Error(`Error uploading functions cache: ${error.message}`);
  }
}

interface DownloadCacheSettings {
  localCacheFolder: string;
  storageBaseUrl: string;
}

/**
 * @param cacheFolder - Cache folder
 * @param settings - Settings object
 */
export async function downloadCache(
  cacheFolder: string,
  settings: DownloadCacheSettings,
): Promise<any> {
  const { localCacheFolder, storageBaseUrl } = settings;

  // TODO: Look into creating a list of files and piping them to the stdin of gsutil
  try {
    const srcPath = `${storageBaseUrl}/${cacheFolder}`;
    info(`Downloading cache from: "${srcPath}" to "${localCacheFolder}"`);
    await exec(
      'gsutil',
      gsutilDefaultArgs.concat(['cp', '-r', srcPath, `${localCacheFolder}/`]),
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
 * @param localFolder - Local cache folder path
 */
export async function createLocalCacheFolder(
  localFolder: string,
): Promise<void> {
  try {
    // Create local folder for cache
    await mkdirP(localFolder);
  } catch (error) {
    throw new Error(`Failed to create local cache folder: ${error}`);
  }
}
