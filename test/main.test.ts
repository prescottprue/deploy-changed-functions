import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as io from '@actions/io';
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

describe('run function', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('Throws if GITHUB_WORKSPACE is not set', async () => {
    await run();
    expect(core.setFailed).toHaveBeenCalledWith('Missing GITHUB_WORKSPACE!');
  });

  it('Throws if project-id input is not set', async () => {
    process.env.GITHUB_WORKSPACE = process.cwd();
    await run();
    expect(core.setFailed).toHaveBeenCalledWith(
      'Missing required input "project-id"',
    );
  });

  it('Calls gsutil to download functions cache from cloud storage to local folder', async () => {
    const cwd = process.cwd();
    process.env.GITHUB_WORKSPACE = cwd;
    const projectName = 'someProject';
    // Mock getInput to pass project-id input
    (core.getInput as jest.Mock).mockImplementation((inputName: string) => {
      if (inputName === 'project-id') {
        return projectName;
      }
      return null;
    });

    await run();
    const localCacheFolderPath = `${cwd}/local_functions_cache`;
    // Confirm that local folder is created
    expect(io.mkdirP).toHaveBeenCalledWith(localCacheFolderPath);

    // Confirm that exec is called with gsutil and correct arguments
    expect(exec.exec).toHaveBeenCalledWith('gsutil', [
      '-m',
      '-q',
      'cp',
      '-r',
      `gs://${projectName}.appspot.com/functions_deploy_cache`,
      `${localCacheFolderPath}/`,
    ]);
  });
});
