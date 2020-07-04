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

/**
 * @param inputValues - Object of input values by name
 */
function mockInputValues(inputValues: Record<string, string>) {
  // Mock getInput to pass project-id input
  (getInput as jest.Mock).mockImplementation((inputName: string) => {
    return inputValues[inputName] || '';
  });
}

describe('run function', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('Throws if project-id input is not set', async () => {
    await run();
    expect(setFailed).toHaveBeenCalledWith(
      'Missing required input "project-id"',
    );
  });

  it('Throws if token input is not set', async () => {
    const projectName = 'someProject';
    mockInputValues({ 'project-id': projectName });
    await run();
    expect(setFailed).toHaveBeenCalledWith('Missing required input "token"');
  });

  it('Calls gsutil to download functions cache from cloud storage to local folder', async () => {
    const projectName = 'someProject';
    mockInputValues({ 'project-id': projectName, token: 'faketoken' });
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
