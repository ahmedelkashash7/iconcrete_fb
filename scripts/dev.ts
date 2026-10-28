/**
 * Dev runner: starts the Bun API (port 3001) and Vite (port 3000) together.
 * Both children are killed when this process receives SIGINT/SIGTERM.
 */
const children = [
  Bun.spawn(['bun', 'run', 'server/index.ts'], {
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...process.env },
  }),
  Bun.spawn([`${import.meta.dir}/../node_modules/.bin/vite`], {
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...process.env },
  }),
];

const shutdown = () => {
  for (const child of children) {
    try {
      child.kill();
    } catch {
      /* already stopped */
    }
  }
};

process.on('SIGINT', () => {
  shutdown();
  process.exit(0);
});
process.on('SIGTERM', () => {
  shutdown();
  process.exit(0);
});

const exitCode = await Promise.race(children.map((child) => child.exited));
shutdown();
process.exit(exitCode);
