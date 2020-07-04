import { setFailed, getInput } from '@actions/core';
import { exec } from '@actions/exec';
import { mkdirP } from '@actions/io';
import run from '../src/main';

jest.mock('@actions/core', () => ({
  getInput: jest.fn(),
  setFailed: jest.fn(),
  warning: jest.fn(),
  info: jest.fn(),
}));

jest.mock('@actions/io', () => ({
  mkdirP: jest.fn(() => Promise.resolve(0)),
}));

jest.mock('@actions/exec', () => ({
  exec: jest.fn(() => Promise.resolve(0)),
}));

const cwd = process.cwd();
process.env.GITHUB_WORKSPACE = cwd;

describe('run function', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('Throws if project-id input is not set', async () => {
    process.env.GITHUB_WORKSPACE = process.cwd();
    await run();
    expect(setFailed).toHaveBeenCalledWith(
      'Missing required input "project-id"',
    );
  });

  it('Calls gsutil to download functions cache from cloud storage to local folder', async () => {
    const projectName = 'someProject';
    // Mock getInput to pass project-id input
    (getInput as jest.Mock).mockImplementation((inputName: string) => {
      if (inputName === 'project-id') {
        return projectName;
      }
      return null;
    });

    await run();
    const localCacheFolderPath = `${cwd}/local_functions_cache`;
    // Confirm that local folder is created
    expect(mkdirP).toHaveBeenCalledWith(localCacheFolderPath);

    // Confirm that exec is called with gsutil and correct arguments
    expect(exec).toHaveBeenCalledWith('gsutil', [
      '-m',
      '-q',
      'cp',
      '-r',
      `gs://${projectName}.appspot.com/functions_deploy_cache`,
      `${localCacheFolderPath}/`,
    ]);
  });
});
