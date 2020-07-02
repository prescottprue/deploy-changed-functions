import * as core from '@actions/core';
// import { exec } from '@actions/exec';
import run from '../src/main';

jest.mock('@actions/core', () => ({
  getInput: jest.fn((inputName) => {
    if (inputName === 'cache-folder') {
      return 'some/asdf';
    }
    if (inputName === 'local-folder') {
      return 'local/folder';
    }
    if (inputName === 'functions-folder') {
      return 'functions';
    }
  }),
  setFailed: jest.fn(),
  warning: jest.fn(),
  info: jest.fn(),
}));

jest.mock('@actions/exec', () => ({
  exec: jest.fn(() => Promise.resolve(0)),
  // exec: async (command: string, commandArgs: string[]) => {
  //   if (command === 'gsutil') {
  //     return 0;
  //   }
  //   return new Promise((resolve, reject) => {
  //     exec(`${command} ${commandArgs.join(' ')}`, (error) => {
  //       if (error) {
  //         reject(error);
  //       } else {
  //         resolve();
  //       }
  //     });
  //   });
  // },
}));

describe('run function', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('Should throw if GITHUB_WORKSPACE is not set', async () => {
    await run();
    expect(core.setFailed).toHaveBeenCalledWith('Missing GITHUB_WORKSPACE!');
  });

  it('Should throw if project_id input is not set', async () => {
    process.env.GITHUB_WORKSPACE = process.cwd();
    await run();
    expect(core.setFailed).toHaveBeenCalledWith(
      'Missing required input "project-id"',
    );
  });

  it('Fails if ', async () => {
    process.env.GITHUB_WORKSPACE = `${process.cwd()}`;
    await run();
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('Error checking for diff for path "src"'),
    );
  });
});
