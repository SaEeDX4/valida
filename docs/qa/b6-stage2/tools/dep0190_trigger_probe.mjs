// Reproduces, on any OS, the condition behind the DEP0190 warning seen in the owner's Windows verify:b6 log,
// and when Node prints it. Nothing here touches the project; the child just runs `node -e 0`.
// usage: node dep0190_trigger_probe.mjs <case>   case = shell-with-args | shell-no-args | no-shell
import { spawnSync } from 'node:child_process';
const which = process.argv[2];
const node = JSON.stringify(process.execPath);
if (which === 'shell-with-args') spawnSync(node, ['-e', '0'], { shell: true, stdio: 'ignore' });     // the verify-b6.mjs pattern on win32
if (which === 'shell-no-args') spawnSync(`${node} -e 0`, { shell: true, stdio: 'ignore' });          // one pre-built command string
if (which === 'no-shell') spawnSync(process.execPath, ['-e', '0'], { stdio: 'ignore' });             // no shell at all
process.stdout.write(`[${which}] synchronous part finished (like verify-b6.mjs up to its first await)\n`);
await new Promise((resolve) => setTimeout(resolve, 20));
process.stdout.write(`[${which}] after the first await\n`);
