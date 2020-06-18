import * as core from '@actions/core';
import { mkdirP } from '@actions/io';
import { promises as fs, existsSync } from 'fs';
import path from 'path';

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
 * @param parentPath
 * @returns {object} Contents of firebase.json
 */
export async function loadFirebaseJson(
  parentPath?: string,
): Promise<FirebaseJson> {
  const firebaseJsonPath = `${
    parentPath || process.env.GITHUB_WORKSPACE
  }/firebase.json`;
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

/**
 * @param changedFiles - List of changed files
 * @returns List of changed functions
 */
export function onlyChangedFunctions(changedFiles: string[]): string | null {
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
