#!/usr/bin/env node
import { Command } from 'commander';
import { allDrivers, getDriver, registerDriver } from '../devices/registry';
import { ZhsunycoDriver } from '../devices/zhsunyco';

registerDriver(new ZhsunycoDriver());

const program = new Command();
program.name('esl-cli').description('Local CLI for testing ESL device scan and paint without a SignalK server');

program
  .command('scan')
  .description('Scan for supported BLE ESL devices across all registered vendor drivers')
  .option('-d, --duration <seconds>', 'scan duration in seconds', '10')
  .action(async (opts) => {
    const durationMs = Number(opts.duration) * 1000;
    for (const driver of allDrivers()) {
      const found = await driver.scan(durationMs);
      for (const device of found) {
        console.log(`${driver.vendor}\t${device.address}\t${device.name ?? ''}`);
      }
    }
  });

program
  .command('paint')
  .description('Render a template with dummy data and send it to a device')
  .requiredOption('-v, --vendor <vendor>', 'vendor driver to use')
  .requiredOption('-a, --address <address>', 'BLE address of the device')
  .action(async (opts) => {
    const driver = getDriver(opts.vendor);
    if (!driver) {
      throw new Error(`no driver registered for vendor "${opts.vendor}"`);
    }
    throw new Error('paint not yet implemented: needs the SVG renderer (see SvgRenderer)');
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
