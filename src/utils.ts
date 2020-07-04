import { warning } from '@actions/core';
import { mkdirP } from '@actions/io';
import { promises as fs, existsSync } from 'fs';

interface FunctionsFirebaseSetting {
  source?: string;
  ignore?: string[];
  predeploy?: string[];
}

export interface FirebaseJson {
  functions?: FunctionsFirebaseSetting;
}

/**
 * Load firebase.json from root of project
 * @param parentPath - Parent path of firebase.json (defaults to GITHUB_WORKSPACE)
 * @returns {object} Contents of firebase.json
 */
export async function loadFirebaseJson(
  parentPath?: string,
): Promise<FirebaseJson | undefined> {
  const firebaseJsonPath = `${
    parentPath || process.env.GITHUB_WORKSPACE
  }/firebase.json`;
  if (!existsSync(firebaseJsonPath)) {
    warning(`firebase.json not found at path: "${firebaseJsonPath}"`);
    return undefined;
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

/**
 * @param changedFiles - List of changed files
 * @returns List of changed functions
 */
export function onlyChangedFunctions(changedFiles: string[]): string | null {
  // TODO: Filter list of changed files
  const inputLines = changedFiles.filter(Boolean);
  const foldersToIgnore = ['utils', 'constants'];
  // Convert full file paths to folder paths. Handles nested files/folders including:
  // src/adminApi/routes/teams/db.js
  // src/adminApi/routes/index.js
  // src/shortenUrl/index.js
  const srcFolderRegex = new RegExp(/src\/([a-zA-Z]*)\//);
  const inputPathNames = inputLines.map((currentFilePath) => {
    const results = srcFolderRegex.exec(currentFilePath);
    if (!results?.length) {
      throw new Error('No regex results when scanning for src path');
    }
    return results[1];
  });
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
