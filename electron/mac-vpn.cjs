'use strict';

const path = require('node:path');

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function appleScriptString(value) {
  return JSON.stringify(String(value));
}

function buildMacVpnStartScript({ core, config, pidFile, logFile }) {
  const pid = shellQuote(pidFile);
  return [
    'umask 077',
    `export PATH=${shellQuote(`${path.dirname(core)}:/usr/bin:/bin:/usr/sbin:/sbin`)}`,
    `old_pid=$(cat ${pid} 2>/dev/null || true)`,
    'case "$old_pid" in ""|*[!0-9]*) ;; *) kill "$old_pid" 2>/dev/null || true ;; esac',
    `rm -f ${pid}`,
    `nohup ${shellQuote(core)} run -c ${shellQuote(config)} > ${shellQuote(logFile)} 2>&1 < /dev/null &`,
    `echo $! > ${pid}`,
  ].join('\n');
}

function buildMacVpnStopScript(pidFile) {
  const pid = shellQuote(pidFile);
  return [
    `vpn_pid=$(cat ${pid} 2>/dev/null || true)`,
    'case "$vpn_pid" in ""|*[!0-9]*) ;; *) kill "$vpn_pid" 2>/dev/null || true; sleep 1; kill -9 "$vpn_pid" 2>/dev/null || true ;; esac',
    `rm -f ${pid}`,
  ].join('\n');
}

function privilegedAppleScript(shellScript) {
  return `do shell script ${appleScriptString(shellScript)} with administrator privileges`;
}

module.exports = { buildMacVpnStartScript, buildMacVpnStopScript, privilegedAppleScript, shellQuote };
