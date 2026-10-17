import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { encrypt, decrypt } from './archive.mjs';
import { digest, rowDigest, readTables, requirePublicTables, requireIsolatedContainer } from './proof.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
// The production project is checked by hash so the public source does not name it.
const projectRefSha256 = 'c132fa25ef2dfb2f1f823a7d33885acb84cacabb16777d671f9256c8f5d99876';
let project = null;
const cli = path.join(repo, 'node_modules/supabase/dist/supabase.js');
const passphrase = process.env.CRH_BACKUP_PASSPHRASE;
delete process.env.CRH_BACKUP_PASSPHRASE;
let phase = 'preflight';
let cancelled = false;
process.on('SIGINT', () => { cancelled = true; });

function execute(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repo, encoding: 'utf8', windowsHide: true, timeout: 240_000,
    maxBuffer: 64 * 1024 * 1024, ...options,
  });
  if (result.error || result.status !== 0 || cancelled) {
    // Child errors can contain COPY data or credentials. Never forward them.
    const error = new Error(`${phase} failed${cancelled ? ' (cancelled)' : ''}; command output withheld to protect database contents.`);
    error.sqlState = /(?:ERROR|FATAL):\s+([A-Z0-9]{5})(?:\s|$)/m.exec(result.stderr ?? '')?.[1];
    throw error;
  }
  return result.stdout;
}
function supabase(args) { return execute(process.execPath, [cli, ...args]); }
function query(sql) {
  const response = JSON.parse(supabase(['db', 'query', '--linked', '--output', 'json', sql]));
  if (!Array.isArray(response.rows) || response.rows.length !== 1) throw new Error('Unexpected database query response.');
  return response.rows[0];
}
function preflight() {
  const linked = fs.readFileSync(path.join(repo, 'supabase/.temp/project-ref'), 'utf8').trim();
  if (crypto.createHash('sha256').update(linked).digest('hex') !== projectRefSha256) {
    throw new Error('Linked project differs from Crimson Desert Report Hub. Do not export until the link is checked.');
  }
  project = linked;
  const version = supabase(['--version']).trim();
  if (!version.includes('2.109.1')) throw new Error('This backup workflow requires the repository-pinned Supabase CLI 2.109.1.');
  const scope = query("SELECT json_build_object('auth_users', (SELECT count(*) FROM auth.users), 'storage_objects', (SELECT count(*) FROM storage.objects), 'vault_secrets', (SELECT count(*) FROM vault.secrets)) AS scope;").scope;
  if (!scope || Object.values(scope).some(count => Number(count) !== 0)) {
    throw new Error('Auth users, Storage files or Vault secrets now exist. Extend the recovery plan before using this project-specific workflow.');
  }
  return scope;
}

function writeJson(filename, value) {
  fs.writeFileSync(filename, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}
function catalogQuery(name) { return fs.readFileSync(path.join(here, name), 'utf8'); }
function safeLine(value) { return value.replace(/[\r\n\t]/g, ' ').slice(0, 240); }

function backup() {
  const [directory, reason, operator] = process.argv.slice(2);
  if (!directory || !reason?.trim() || !operator?.trim() || !passphrase || passphrase.length < 16) {
    throw new Error('Run npm run backup for the private password prompt.');
  }
  const run = path.resolve(directory);
  const runId = path.basename(run);
  const relative = path.relative(repo, run);
  const outsideRepo = relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  if (!/^\d{8}T\d{9}Z-[a-f0-9]{8}$/.test(runId) || !outsideRepo ||
      fs.lstatSync(run).isSymbolicLink() || fs.readdirSync(run).length) {
    throw new Error('Expected a new, empty, private backup directory outside Git.');
  }
  const staging = path.join(run, 'staging');
  const extracted = path.join(run, 'checked');
  const zip = path.join(run, 'backup.zip');
  const recoveredZip = path.join(run, 'checked.zip');
  const archive = path.join(run, 'crimson-desert-report-hub.crhbackup');
  const transient = new Set([zip, recoveredZip]);
  let containerId;
  const receipt = {
    status: 'failed', project, startedAtUtc: new Date().toISOString(),
    operator: safeLine(operator), reason: safeLine(reason), archive,
    productionDataModified: false, scheduled: false, offsiteCopy: 'not configured',
  };
  function stage(name, content) {
    const filename = path.join(staging, name);
    transient.add(filename);
    fs.writeFileSync(filename, content, { flag: 'wx' });
  }
  function inspect() {
    const metadata = JSON.parse(execute('docker', ['inspect', containerId, '--format', '{{json .}}']));
    requireIsolatedContainer(metadata, runId);
    return metadata;
  }
  function localSql(sql) {
    return execute('docker', ['exec', containerId, 'psql', '-X', '-q', '-t', '-A', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', sql]);
  }
  let succeeded = false;
  try {
    receipt.scope = preflight();
    receipt.project = project;
    const imageVersion = fs.readFileSync(path.join(repo, 'supabase/.temp/postgres-version'), 'utf8').trim();
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(imageVersion)) throw new Error('Invalid linked Postgres image version.');
    receipt.image = `public.ecr.aws/supabase/postgres:${imageVersion}`;
    execute('docker', ['image', 'inspect', receipt.image]);
    fs.mkdirSync(staging);
    fs.mkdirSync(extracted);
    const catalog = query(catalogQuery('catalog.sql')).catalog;
    const permissions = query(catalogQuery('function-permissions.sql')).permissions;
    if (Number(catalog.browser_table_grants) !== 0) throw new Error('Application browser grants changed; review the restore preparation before proceeding.');
    stage('source_catalog.json', JSON.stringify(catalog));
    stage('source_permissions.json', JSON.stringify(permissions));
    stage('local_restore_prepare.sql', fs.readFileSync(path.join(here, 'local-restore-prepare.sql')));
    const dumps = [
      ['schema.sql', []],
      ['data.sql', ['--data-only', '--use-copy']],
      ['roles.sql', ['--role-only']],
      ['history_schema.sql', ['--schema', 'supabase_migrations']],
      ['history_data.sql', ['--schema', 'supabase_migrations', '--data-only', '--use-copy']],
      ['platform_schema.sql', ['--schema', 'auth,storage']],
    ];
    for (const [name, flags] of dumps) {
      phase = `export ${name}`;
      console.log(`Exporting ${name}...`);
      const target = path.join(staging, name);
      transient.add(target);
      supabase(['db', 'dump', '--linked', ...flags, '--file', target]);
      if (fs.statSync(target).size < 20) throw new Error('Database export was empty.');
    }
    phase = 'source consistency check';
    assert.deepEqual(query(catalogQuery('catalog.sql')).catalog, catalog, 'Schema changed during export; retry outside a migration window.');
    assert.deepEqual(query(catalogQuery('function-permissions.sql')).permissions, permissions, 'Permissions changed during export.');
    const tables = ['data.sql', 'history_data.sql'].flatMap(name => readTables(fs.readFileSync(path.join(staging, name), 'utf8')));
    requirePublicTables(tables, catalog);
    const files = fs.readdirSync(staging).sort().map(name => {
      const content = fs.readFileSync(path.join(staging, name));
      return { name, bytes: content.length, sha256: digest(content) };
    });
    const manifest = { project, createdAtUtc: new Date().toISOString(), image: receipt.image, files, tables };
    stage('manifest.json', JSON.stringify(manifest, null, 2));
    phase = 'encryption';
    console.log('Encrypting the archive and checking decryption...');
    execute('tar', ['-a', '-c', '-f', zip, '-C', staging, ...fs.readdirSync(staging)]);
    const plain = fs.readFileSync(zip);
    const encrypted = encrypt(plain, passphrase);
    fs.writeFileSync(archive, encrypted, { flag: 'wx' });
    fs.copyFileSync(path.join(here, 'archive.mjs'), path.join(run, 'archive.mjs'), fs.constants.COPYFILE_EXCL);
    fs.copyFileSync(path.join(here, 'decrypt.ps1'), path.join(run, 'Decrypt-Backup.ps1'), fs.constants.COPYFILE_EXCL);
    const recovered = decrypt(fs.readFileSync(archive), passphrase);
    if (!recovered.equals(plain)) throw new Error('Decrypted archive differs from its source.');
    receipt.sha256 = digest(encrypted);
    receipt.bytes = encrypted.length;
    fs.writeFileSync(recoveredZip, recovered, { flag: 'wx' });
    plain.fill(0);
    recovered.fill(0);
    // Extract only known generated filenames; register paths before extraction.
    const names = [...files.map(file => file.name), 'manifest.json'];
    for (const name of names) transient.add(path.join(extracted, name));
    execute('tar', ['-x', '-f', recoveredZip, '-C', extracted, ...names]);
    for (const file of files) {
      if (digest(fs.readFileSync(path.join(extracted, file.name))) !== file.sha256) throw new Error('Decrypted file checksum mismatch.');
    }
    // Restore proof uses the files read back from the archive, including its manifest.
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(extracted, 'manifest.json'), 'utf8')), manifest);
    phase = 'isolated restore';
    console.log('Restoring into a temporary Docker database with no network or published ports...');
    const containerName = `crh-backup-${runId.toLowerCase()}`;
    containerId = execute('docker', ['run', '--rm', '-d', '--name', containerName, '--label', `crh.backup.run=${runId}`, '--network', 'none', '-e', 'POSTGRES_PASSWORD', receipt.image], {
      env: { ...process.env, POSTGRES_PASSWORD: crypto.randomBytes(32).toString('base64') },
    }).trim();
    if (!/^[a-f0-9]{64}$/.test(containerId)) throw new Error('Docker did not return a container ID.');
    inspect();
    phase = 'restore database readiness';
    // The image opens a temporary Unix socket during initialization. TCP only
    // becomes ready after initialization finishes and the final server starts.
    execute('docker', ['exec', containerId, 'sh', '-c', 'for i in $(seq 1 45); do pg_isready -h 127.0.0.1 -U supabase_admin -d postgres >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1'], { timeout: 55_000 });
    phase = 'copy decrypted files into restore database';
    execute('docker', ['cp', extracted, `${containerId}:/backup`]);
    phase = 'restore schema and data';
    execute('docker', ['exec', containerId, 'psql', '-X', '-q', '-U', 'supabase_admin', '-d', 'postgres', '--single-transaction', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate', '-v', 'SHOW_CONTEXT=never',
      '-c', 'DROP SCHEMA auth, storage CASCADE;',
      '-f', '/backup/roles.sql', '-f', '/backup/platform_schema.sql', '-f', '/backup/local_restore_prepare.sql',
      '-c', 'SET ROLE postgres;', '-f', '/backup/schema.sql', '-f', '/backup/history_schema.sql',
      '-c', 'RESET ROLE;', '-f', '/backup/data.sql', '-f', '/backup/history_data.sql']);
    phase = 'restore verification';
    console.log('Comparing every exported table, schema definitions and access permissions...');
    const rows = [];
    for (const table of tables) {
      const sql = `SET timezone='UTC'; SET datestyle='ISO'; SET bytea_output='hex'; COPY "${table.schema}"."${table.table}" (${table.columns}) TO STDOUT;`;
      const output = localSql(sql);
      const lines = output === '' ? [] : output.replace(/\n$/, '').split('\n');
      if (lines.length !== table.rows || rowDigest(lines) !== table.sha256) throw new Error('Restored table contents differ from the archive.');
      rows.push({ schema: table.schema, table: table.table, rows: lines.length, contentHashMatches: true });
    }
    assert.deepEqual(JSON.parse(localSql(catalogQuery('catalog.sql'))), catalog, 'Restored schema differs.');
    assert.deepEqual(JSON.parse(localSql(catalogQuery('function-permissions.sql'))), permissions, 'Restored function permissions differ.');
    receipt.verification = {
      decryption: 'passed', restore: 'passed', rows: rows.reduce((sum, table) => sum + table.rows, 0),
      exportedTables: rows.length, publicTables: rows.filter(table => table.schema === 'public').length,
      catalogTables: catalog.tables.length, functions: catalog.functions.length,
      constraints: catalog.constraints.length, indexes: catalog.indexes.length, triggers: catalog.triggers.length,
      schemaAndPermissions: 'matched',
    };
    writeJson(path.join(run, 'row-verification.json'), rows);
    succeeded = true;
  } catch (error) {
    // Assertion errors can include private definitions. Record only the phase.
    receipt.failure = `${phase} failed. Do not treat this run as a verified backup.`;
    if (error.sqlState) receipt.sqlState = error.sqlState;
    console.error(receipt.failure);
  } finally {
    cancelled = false;
    phase = 'cleanup';
    const cleanupErrors = [];
    if (containerId) {
      try {
        inspect();
        execute('docker', ['stop', '--timeout', '5', containerId]);
      } catch { cleanupErrors.push('Temporary restore container needs inspection.'); }
    }
    // Only exact files created by this run. No recursive deletion or retention pruning.
    for (const filename of transient) {
      try { if (fs.existsSync(filename)) fs.unlinkSync(filename); }
      catch { cleanupErrors.push(`Remove private temporary file: ${filename}`); }
    }
    for (const folder of [staging, extracted]) {
      try { if (fs.existsSync(folder)) fs.rmdirSync(folder); }
      catch { cleanupErrors.push(`Inspect private temporary directory: ${folder}`); }
    }
    receipt.cleanup = cleanupErrors.length ? cleanupErrors : 'passed';
    receipt.completedAtUtc = new Date().toISOString();
    receipt.status = succeeded && !cleanupErrors.length ? 'verified' : 'failed';
    writeJson(path.join(run, 'receipt.json'), receipt);
  }
  if (receipt.status !== 'verified') {
    throw new Error(`Backup incomplete. See ${path.join(run, 'receipt.json')}. Encrypted archives, if present, were retained.`);
  }
  phase = 'ledger update';
  const entry = `\n## ${receipt.completedAtUtc} — verified\n\n` +
    `- Who: ${receipt.operator}.\n- Why: ${receipt.reason}.\n- Project: \`${project}\`.\n` +
    `- Archive: \`${archive}\` (${receipt.bytes} bytes).\n- SHA-256: \`${receipt.sha256}\`.\n` +
    `- Proof: ${receipt.verification.rows} rows across ${receipt.verification.exportedTables} tables (${receipt.verification.publicTables} public); decrypted and restored in isolated Docker. Schema definitions and access checks matched.\n` +
    `- Receipt: \`${path.join(run, 'receipt.json')}\`. Cleanup passed. Offsite copy: not configured.\n`;
  fs.appendFileSync(path.join(repo, 'docs/BACKUP-STATE.md'), entry);
  console.log(`Verified backup: ${archive}\n${receipt.verification.rows} rows verified. Backup ledger updated; no commit or push performed.`);
}

try {
  if (process.argv[2] === '--check-docker') {
    phase = 'Docker readiness check';
    execute('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 5_000 });
    console.log('Docker is ready. The backup stops only its own test container and leaves Desktop running.');
  } else if (process.argv[2] === '--check') {
    preflight();
    console.log('Backup preflight passed: correct project, CLI access and supported data scope.');
  } else backup();
} catch (error) {
  // Only our own preflight/summary errors are surfaced, never child output.
  console.error(error instanceof assert.AssertionError ? `${phase} failed.` : error.message);
  process.exitCode = 1;
}
