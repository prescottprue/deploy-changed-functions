import * as core from '@actions/core';
import { exec } from 'child_process';
import { run } from '../src';

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
  exec: async (command: string, commandArgs: string[]) => {
    if (command === 'gsutil') {
      return 0;
    }
    return new Promise((resolve, reject) => {
      exec(`${command} ${commandArgs.join(' ')}`, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  },
}));

describe('run function', () => {
  it('Should throw if GITHUB_WORKSPACE is not set', async () => {
    await run();
    expect(core.setFailed).toHaveBeenCalledWith('Missing GITHUB_WORKSPACE!');
  });

  it('Sets failure for not matching', async () => {
    process.env.GITHUB_WORKSPACE = `${__dirname}/..`;
    await run();
    expect(core.setFailed).toBeCalled();
  });
});
