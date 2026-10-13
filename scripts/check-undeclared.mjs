// Gate: no identifier may be used that is never declared.
//
// WHY THIS EXISTS. Two defects shipped to main within three days, both
// the same shape, both invisible to every other check:
//
//   dtSec   used in the `engaging` branch, declared in the sibling
//           `en_route` branch. Threw every frame, killed the
//           counter-dispatch loop, froze every interceptor mid-air.
//   ownerId used in _fireDelayedOORForEmptiedSites, declared inside
//           processDroneSiteMarkers. Threw on any swarm member death.
//
// Neither was caught by the 16 existing gates, because none does scope
// analysis. There is no eslint in this repo. And a bundler will happily
// emit an unresolved identifier as a global reference, so a green build
// says nothing about this class of bug. In an ES module it is a hard
// ReferenceError at runtime, and because the dispatch and drone ticks
// reschedule themselves with requestAnimationFrame AFTER the work, one
// throw stops the animation permanently rather than for one frame.
//
// A single no-undef rule would have caught both for nothing. This is
// that rule, built on the parser the bundler already ships.
import fs from 'fs';
import { parseAst } from 'rolldown/parseAst';

const FILES = process.env.SCOPE_FILES ? process.env.SCOPE_FILES.split(',') : ['src/main.js', 'src/drones.js', 'src/events.js', 'src/scene_lifecycle.js',
               'src/track_clustering.js', 'src/post_incident_report.js', 'src/destinations.js',
               'src/live_sensor.js'];

// Globals a browser module may legitimately reach for. Deliberately
// short: anything not here must be declared in the file.
const GLOBALS = new Set([
  'window','document','console','Math','JSON','Date','Object','Array','String','Number','Boolean',
  'Set','Map','WeakMap','WeakSet','Promise','Symbol','RegExp','Error','TypeError','RangeError',
  'parseInt','parseFloat','isNaN','isFinite','encodeURIComponent','decodeURIComponent','structuredClone',
  'setTimeout','clearTimeout','setInterval','clearInterval','requestAnimationFrame','cancelAnimationFrame',
  'fetch','URL','URLSearchParams','Blob','FileReader','File','FormData','Headers','Request','Response',
  'localStorage','sessionStorage','indexedDB','IDBKeyRange','navigator','location','history','performance',
  'Intl','TextEncoder','TextDecoder','AbortController','CustomEvent','Event','EventTarget','MutationObserver',
  'ResizeObserver','IntersectionObserver','Image','Audio','canvas','HTMLElement','Node','NodeList',
  'crypto','atob','btoa','queueMicrotask','globalThis','undefined','NaN','Infinity','alert','confirm','prompt',
  'Float32Array','Float64Array','Uint8Array','Uint16Array','Uint32Array','Int8Array','Int16Array','Int32Array',
  'ArrayBuffer','DataView','Proxy','Reflect','BigInt','WebSocket','Worker','process','module','require','exports',
]);

const SCOPED = new Set(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression',
                        'BlockStatement','ForStatement','ForInStatement','ForOfStatement',
                        'CatchClause','Program','ClassDeclaration','ClassExpression',
                        'StaticBlock','SwitchStatement']);

function patternNames(node, out) {
  if (!node) return out;
  switch (node.type) {
    case 'Identifier': out.push(node.name); break;
    case 'ObjectPattern': node.properties.forEach(p =>
      patternNames(p.type === 'RestElement' ? p.argument : p.value, out)); break;
    case 'ArrayPattern': node.elements.forEach(e => patternNames(e, out)); break;
    case 'AssignmentPattern': patternNames(node.left, out); break;
    case 'RestElement': patternNames(node.argument, out); break;
  }
  return out;
}

let failures = [];

for (const file of FILES) {
  if (!fs.existsSync(file)) continue;
  const code = fs.readFileSync(file, 'utf8');
  const ast = parseAst(code, { lang: 'js' });

  // Pass 1: collect declarations per scope node.
  const declsFor = new Map();
  const add = (scope, name) => {
    if (!name) return;
    if (!declsFor.has(scope)) declsFor.set(scope, new Set());
    declsFor.get(scope).add(name);
  };

  const walk = (node, parent, scopeStack, cb) => {
    if (!node || typeof node.type !== 'string') return;
    const opensScope = SCOPED.has(node.type);
    const stack = opensScope ? [...scopeStack, node] : scopeStack;
    cb(node, parent, stack);
    for (const k of Object.keys(node)) {
      if (k === 'type' || k === 'start' || k === 'end' || k === 'loc' || k === 'parent') continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach(c => c && typeof c.type === 'string' && walk(c, node, stack, cb));
      else if (v && typeof v.type === 'string') walk(v, node, stack, cb);
    }
  };

  const fnScope = (stack) => {
    for (let i = stack.length - 1; i >= 0; i--) {
      const t = stack[i].type;
      if (t === 'FunctionDeclaration' || t === 'FunctionExpression'
          || t === 'ArrowFunctionExpression' || t === 'Program') return stack[i];
    }
    return stack[0];
  };

  walk(ast, null, [], (node, parent, stack) => {
    const here = stack[stack.length - 1];
    switch (node.type) {
      case 'VariableDeclaration':
        node.declarations.forEach(d =>
          patternNames(d.id, []).forEach(n =>
            add(node.kind === 'var' ? fnScope(stack) : here, n)));
        break;
      case 'FunctionDeclaration':
      case 'ClassDeclaration':
        if (node.id) add(stack[stack.length - 2] || here, node.id.name);
        node.params?.forEach(p => patternNames(p, []).forEach(n => add(node, n)));
        break;
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        if (node.id) add(node, node.id.name);
        node.params?.forEach(p => patternNames(p, []).forEach(n => add(node, n)));
        break;
      case 'CatchClause':
        patternNames(node.param, []).forEach(n => add(node, n));
        break;
      case 'ImportDeclaration':
        node.specifiers.forEach(s => add(ast, s.local.name));
        break;
      case 'ForStatement': case 'ForInStatement': case 'ForOfStatement': {
        const init = node.init || node.left;
        if (init && init.type === 'VariableDeclaration') {
          init.declarations.forEach(d => patternNames(d.id, []).forEach(n => add(node, n)));
        }
        break;
      }
    }
  });

  // Pass 2: every identifier REFERENCE must resolve up the scope chain.
  const isRef = (node, parent, key) => {
    if (node.type !== 'Identifier') return false;
    if (!parent) return false;
    const p = parent;
    if (p.type === 'MemberExpression' && p.property === node && !p.computed) return false;
    if (p.type === 'Property' && p.key === node && !p.computed) return false;
    if (p.type === 'MethodDefinition' && p.key === node && !p.computed) return false;
    if (p.type === 'PropertyDefinition' && p.key === node && !p.computed) return false;
    if ((p.type === 'FunctionDeclaration' || p.type === 'FunctionExpression'
      || p.type === 'ArrowFunctionExpression' || p.type === 'ClassDeclaration') && p.id === node) return false;
    if (p.type === 'ImportSpecifier' || p.type === 'ImportDefaultSpecifier'
      || p.type === 'ImportNamespaceSpecifier') return false;
    if (p.type === 'LabeledStatement' || p.type === 'BreakStatement' || p.type === 'ContinueStatement') return false;
    // import.meta parses as MetaProperty with two Identifier children.
    if (p.type === 'MetaProperty') return false;
    // Export aliases: `export { a as b }` — b is not a reference.
    if (p.type === 'ExportSpecifier' && p.exported === node) return false;
    return true;
  };

  const declaredAnywhere = new Set();
  for (const s of declsFor.values()) for (const n of s) declaredAnywhere.add(n);

  const seen = new Set();
  const walk2 = (node, parent, stack) => {
    if (!node || typeof node.type !== 'string') return;
    const stack2 = SCOPED.has(node.type) ? [...stack, node] : stack;
    if (node.type === 'Identifier' && isRef(node, parent)) {
      const name = node.name;
      if (!GLOBALS.has(name)) {
        let found = false;
        for (let i = stack2.length - 1; i >= 0; i--) {
          const d = declsFor.get(stack2[i]);
          if (d && d.has(name)) { found = true; break; }
        }
        // Function declarations hoist to their enclosing function, and
        // this whole app lives inside one big main(); treat any name
        // declared somewhere in the file as resolvable only if it is
        // declared in an ANCESTOR scope. That is the whole point.
        if (!found) {
          const line = code.slice(0, node.start).split('\n').length;
          const k = `${name}:${line}`;
          if (!seen.has(k)) { seen.add(k); failures.push({ file, line, name }); }
        }
      }
    }
    for (const k of Object.keys(node)) {
      if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach(c => c && typeof c.type === 'string' && walk2(c, node, stack2));
      else if (v && typeof v.type === 'string') walk2(v, node, stack2);
    }
  };
  walk2(ast, null, []);
}

if (failures.length) {
  console.error('✗ Undeclared identifiers (hard ReferenceError at runtime):');
  for (const f of failures.slice(0, 40)) console.error(`    ${f.file}:${f.line}  ${f.name}`);
  if (failures.length > 40) console.error(`    ... and ${failures.length - 40} more`);
  process.exit(1);
}
console.log('✓ No undeclared identifiers. Every name resolves in an enclosing scope.');
