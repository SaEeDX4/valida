import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { TempUploadArea } from '../src/lib/multipart/tempUploadArea.js';
import { makeTestRoot, removeTestRoot } from './fixtures/uploadHarness.js';

/**
 * B4 — owned temporary upload files (Doc 09 section 105, Doc 13 sections
 * 255-256). The area may delete ONLY what it created: these tests plant
 * foreign files and directories and check they survive every cleanup path.
 */
const isPosix = process.platform !== 'win32';
const DAY = 24 * 60 * 60 * 1000;

let base;
beforeEach(() => {
  base = path.join(makeTestRoot(), 'tmp');
  fs.mkdirSync(base);
});
afterEach(() => {
  removeTestRoot(path.dirname(base));
});

describe('the per-process area', () => {
  it('is a fresh, randomly named, owner-only directory', async () => {
    const first = await TempUploadArea.create({ baseDirectory: base });
    const second = await TempUploadArea.create({ baseDirectory: base });
    expect(first.directory).not.toBe(second.directory);
    expect(path.basename(first.directory)).toMatch(/^valida-upload-[A-Za-z0-9]{6}$/);
    expect(path.dirname(first.directory)).toBe(base);
    if (isPosix) expect(fs.statSync(first.directory).mode & 0o777).toBe(0o700);
    await first.close();
    await second.close();
  });

  it('reserves random, unique file names that no client value influences', async () => {
    const area = await TempUploadArea.create({ baseDirectory: base });
    const names = new Set(Array.from({ length: 200 }, () => path.basename(area.reserveFile().path)));
    expect(names.size).toBe(200);
    names.forEach((name) => expect(name).toMatch(/^up-[0-9a-f]{32}\.part$/));
    expect(area.ownedCount).toBe(200);
    await area.close();
  });

  it('release() deletes an owned file and is idempotent', async () => {
    const area = await TempUploadArea.create({ baseDirectory: base });
    const file = area.reserveFile();
    fs.writeFileSync(file.path, 'QA');
    expect(await area.release(file)).toBe(true);
    expect(fs.existsSync(file.path)).toBe(false);
    expect(await area.release(file)).toBe(false);
    expect(area.ownedCount).toBe(0);
    await area.close();
  });

  it('release() refuses anything it did not issue — a path string, a look-alike, another area\'s file', async () => {
    const area = await TempUploadArea.create({ baseDirectory: base });
    const other = await TempUploadArea.create({ baseDirectory: base });
    const foreign = other.reserveFile();
    fs.writeFileSync(foreign.path, 'must survive');
    const victim = path.join(path.dirname(base), 'victim.txt');
    fs.writeFileSync(victim, 'must survive');

    await expect(area.release(victim)).rejects.toThrow(TypeError);
    await expect(area.release({ path: victim })).rejects.toThrow(TypeError);
    await expect(area.release(Object.freeze({ path: victim }))).rejects.toThrow(TypeError);
    await expect(area.release(foreign)).rejects.toThrow(TypeError);
    expect(fs.readFileSync(victim, 'utf8')).toBe('must survive');
    expect(fs.readFileSync(foreign.path, 'utf8')).toBe('must survive');
    await area.close();
    await other.close();
  });

  it('close() removes its files and its directory, but never a file it did not create', async () => {
    const area = await TempUploadArea.create({ baseDirectory: base });
    const owned = area.reserveFile();
    fs.writeFileSync(owned.path, 'QA');
    const planted = path.join(area.directory, 'planted-by-someone-else.txt');
    fs.writeFileSync(planted, 'must survive');
    await area.close();
    expect(fs.existsSync(owned.path)).toBe(false);
    expect(fs.readFileSync(planted, 'utf8')).toBe('must survive');
    // The directory stays because something not ours is in it.
    expect(fs.existsSync(area.directory)).toBe(true);
    expect(() => area.reserveFile()).toThrow(/closed/);
  });

  it('close() of an untouched area removes the directory entirely', async () => {
    const area = await TempUploadArea.create({ baseDirectory: base });
    area.reserveFile(); // reserved but never written
    await area.close();
    expect(fs.existsSync(area.directory)).toBe(false);
    expect(fs.readdirSync(base)).toEqual([]);
  });
});

describe('self-healing', () => {
  it('recreates its directory (owner-only, with its marker) if something outside deleted it', async () => {
    const area = await TempUploadArea.create({ baseDirectory: base });
    fs.rmSync(area.directory, { recursive: true, force: true });
    const file = area.reserveFile();
    fs.writeFileSync(file.path, 'QA');
    expect(fs.existsSync(file.path)).toBe(true);
    expect(fs.readFileSync(path.join(area.directory, '.owner'), 'utf8')).toBe(String(process.pid));
    if (isPosix) expect(fs.statSync(area.directory).mode & 0o777).toBe(0o700);
    await area.close();
    expect(fs.existsSync(area.directory)).toBe(false);
  });
});

describe('the start-up sweep of areas abandoned by a crashed process', () => {
  const age = (target, ms) => {
    const when = new Date(Date.now() - ms);
    fs.utimesSync(target, when, when);
  };

  it('removes stale upload files of stale areas, and only those', async () => {
    // A stale abandoned area with two upload files.
    const stale = path.join(base, 'valida-upload-AbC123');
    fs.mkdirSync(stale);
    fs.writeFileSync(path.join(stale, `up-${'a'.repeat(32)}.part`), 'QA');
    fs.writeFileSync(path.join(stale, `up-${'b'.repeat(32)}.part`), 'QA');
    age(stale, 2 * DAY);
    // A stale area that also contains a foreign file.
    const mixed = path.join(base, 'valida-upload-XyZ789');
    fs.mkdirSync(mixed);
    fs.writeFileSync(path.join(mixed, `up-${'c'.repeat(32)}.part`), 'QA');
    fs.writeFileSync(path.join(mixed, 'notes.txt'), 'must survive');
    age(mixed, 2 * DAY);
    // A RECENT area (another process may be using it right now).
    const recent = path.join(base, 'valida-upload-Rec3nt');
    fs.mkdirSync(recent);
    fs.writeFileSync(path.join(recent, `up-${'d'.repeat(32)}.part`), 'in use');
    // Directories that are not ours, however old.
    const unrelated = path.join(base, 'someone-elses-dir');
    fs.mkdirSync(unrelated);
    fs.writeFileSync(path.join(unrelated, `up-${'e'.repeat(32)}.part`), 'must survive');
    age(unrelated, 30 * DAY);

    const area = await TempUploadArea.create({ baseDirectory: base });

    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.readdirSync(mixed)).toEqual(['notes.txt']);
    expect(fs.readFileSync(path.join(recent, `up-${'d'.repeat(32)}.part`), 'utf8')).toBe('in use');
    expect(fs.readFileSync(path.join(unrelated, `up-${'e'.repeat(32)}.part`), 'utf8')).toBe('must survive');
    await area.close();
  });

  it('never sweeps the area of a process that is still running, however idle (review finding)', async () => {
    const running = await TempUploadArea.create({ baseDirectory: base });
    const inFlight = running.reserveFile();
    fs.writeFileSync(inFlight.path, 'in use by a live process');
    age(running.directory, 30 * DAY);
    const second = await TempUploadArea.create({ baseDirectory: base });
    expect(fs.readFileSync(inFlight.path, 'utf8')).toBe('in use by a live process');
    expect(fs.readFileSync(path.join(running.directory, '.owner'), 'utf8')).toBe(String(process.pid));
    await second.close();
    await running.close();
  });

  it('sweeps a stale area whose owner process has exited', async () => {
    const exited = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' });
    const dead = path.join(base, 'valida-upload-Dead01');
    fs.mkdirSync(dead);
    fs.writeFileSync(path.join(dead, '.owner'), String(exited.pid));
    fs.writeFileSync(path.join(dead, `up-${'9'.repeat(32)}.part`), 'QA leftover');
    age(dead, 2 * DAY);
    const area = await TempUploadArea.create({ baseDirectory: base });
    expect(fs.existsSync(dead)).toBe(false);
    await area.close();
  });

  it('keeps a stale area whose marker names a live process other than this one', async () => {
    const live = path.join(base, 'valida-upload-Live01');
    fs.mkdirSync(live);
    // The parent of this test process is alive for the whole run.
    fs.writeFileSync(path.join(live, '.owner'), String(process.ppid));
    fs.writeFileSync(path.join(live, `up-${'8'.repeat(32)}.part`), 'still in use');
    age(live, 2 * DAY);
    const area = await TempUploadArea.create({ baseDirectory: base });
    expect(fs.readFileSync(path.join(live, `up-${'8'.repeat(32)}.part`), 'utf8')).toBe('still in use');
    await area.close();
  });

  it.runIf(isPosix)('never follows a symbolic link that looks like an area', async () => {
    const target = path.join(path.dirname(base), 'link-target');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, `up-${'f'.repeat(32)}.part`), 'must survive');
    const link = path.join(base, 'valida-upload-L1nk00');
    fs.symlinkSync(target, link);
    fs.lutimesSync(link, new Date(Date.now() - 2 * DAY), new Date(Date.now() - 2 * DAY));
    const area = await TempUploadArea.create({ baseDirectory: base });
    expect(fs.readFileSync(path.join(target, `up-${'f'.repeat(32)}.part`), 'utf8')).toBe('must survive');
    await area.close();
  });
});
