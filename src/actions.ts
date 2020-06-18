import * as core from '@actions/core';
import { exec } from '@actions/exec';
import { mkdirP } from '@actions/io';
import { promises as fs, existsSync } from 'fs';

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
export async function checkForDiff(
  listOfFilesToDiff: string[],
  options: DiffOptions,
): Promise<string[]> {
  const { localCacheFolder, functionsFolder } = options;
  // Check for change in files
  // TODO: Load ignore settings from functions.ignore of firebase.json
  // TODO: Include changes to firebase.json
  try {
    core.info(
      `Diffing files between paths: "${functionsFolder}" and "${localCacheFolder}"`,
    );
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

interface WriteCacheSettings {
  functionsFolder: string;
  storageBaseUrl: string;
}

/**
 * @param filesToUpload - List of files paths to upload
 * @param settings - Settings object
 */
export async function writeCache(
  filesToUpload: string[],
  settings: WriteCacheSettings,
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

        return exec(
          'gsutil',
          copyArgs.concat([
            `${functionsFolder}/${topLevelPath}`,
            `${storageBaseUrl}/${isDirectory ? '' : topLevelPath}`,
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
    core.info(`Downloading cache from: "${srcPath}" to "${localCacheFolder}"`);
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
 * Load firebase.json from root of project
 * @returns {object} Contents of firebase.json
 */
export async function loadFirebaseJson(): Promise<FirebaseJson> {
  const { GITHUB_WORKSPACE } = process.env;
  const firebaseJsonPath = `${GITHUB_WORKSPACE}/firebase.json`;
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
export async function createLocalCacheFolder(
  localFolder: string,
): Promise<void> {
  try {
    // Create local folder for cache
    await mkdirP(localFolder);
  } catch (error) {
    throw new Error(`Error creating local cache folder: ${error}`);
  }
}
