import type Parser from 'web-tree-sitter'
import type { SymbolKind } from '@shared/types'

type Node = Parser.SyntaxNode

// A name path step tries a field first, then the first named child of that type; `a|b` tries each.
type Path = string[]

type Refine = { kind: SymbolKind; keyword?: string; child?: string; value?: { path: Path; types: string[] } }

export type DeclRule = {
  kind: SymbolKind
  name?: Path
  members?: boolean
  topLevel?: boolean
  requires?: { path: Path; types: string[] }
  refine?: Refine[]
  qualifier?: Path
}

export type Special = { name: string; kind: SymbolKind; decorators: string[]; body: Node | null }

export type Grammar = {
  wasm: string
  family: string
  extensions: string[]
  decls: Record<string, DeclRule>
  // Transparent containers; the value names the qualifier they add (impl blocks) or null (companion objects).
  scopes: Record<string, Path | null>
  wrappers: string[]
  bodies: string[]
  nameTypes: string[]
  refs: Record<string, 'name' | 'member'>
  memberParents: string[]
  leading: string[]
  decorators: string[]
  tests: { names?: RegExp; decorators?: RegExp }
  special: Record<string, (node: Node) => Special | null>
}

const JS_TEST_CALLS = new Set(['describe', 'it', 'test'])
const HTTP_VERBS = new Set(['get', 'post', 'put', 'delete', 'patch'])

function rootIdentifier(node: Node | null): string | null {
  let current = node
  while (current !== null) {
    if (current.type === 'identifier') return current.text
    if (current.type === 'member_expression') current = current.childForFieldName('object')
    else if (current.type === 'call_expression') current = current.childForFieldName('function')
    else return null
  }
  return null
}

function unquote(text: string): string {
  return text.replace(/^[`'"]|[`'"]$/g, '')
}

function callbackBody(args: Node): Node | null {
  for (const arg of [...args.namedChildren].reverse()) {
    if (arg.type === 'arrow_function' || arg.type === 'function_expression' || arg.type === 'function') {
      return arg.childForFieldName('body')
    }
  }
  return null
}

function jsCallSymbol(statement: Node): Special | null {
  const call = statement.firstNamedChild
  if (call?.type !== 'call_expression') return null
  const callee = call.childForFieldName('function')
  const args = call.childForFieldName('arguments')
  const first = args?.firstNamedChild ?? null
  if (callee === null || args === null || first === null) return null
  const isString = first.type === 'string' || first.type === 'template_string'
  const root = rootIdentifier(callee)
  if (root !== null && JS_TEST_CALLS.has(root) && isString) {
    return { name: unquote(first.text), kind: 'test', decorators: [], body: root === 'describe' ? callbackBody(args) : null }
  }
  const verb = callee.type === 'member_expression' ? callee.childForFieldName('property')?.text : undefined
  const path = unquote(first.text)
  if (verb !== undefined && HTTP_VERBS.has(verb) && isString && path.startsWith('/')) {
    return { name: `${verb.toUpperCase()} ${path}`, kind: 'function', decorators: [callee.text], body: null }
  }
  return null
}

function pythonMainBlock(statement: Node): Special | null {
  const condition = statement.childForFieldName('condition')?.text ?? ''
  if (!/__name__\s*==\s*['"]__main__['"]/.test(condition)) return null
  return { name: '__main__', kind: 'function', decorators: ['__main__'], body: null }
}

const JS_DECLS: Record<string, DeclRule> = {
  function_declaration: { kind: 'function' },
  generator_function_declaration: { kind: 'function' },
  class_declaration: { kind: 'class', members: true },
  abstract_class_declaration: { kind: 'class', members: true },
  interface_declaration: { kind: 'interface' },
  type_alias_declaration: { kind: 'type' },
  enum_declaration: { kind: 'enum' },
  method_definition: { kind: 'function' },
  lexical_declaration: {
    kind: 'constant',
    topLevel: true,
    name: ['variable_declarator', 'name'],
    requires: { path: ['variable_declarator', 'name'], types: ['identifier'] },
    refine: [{ kind: 'function', value: { path: ['variable_declarator', 'value'], types: ['arrow_function', 'function_expression', 'function'] } }]
  },
  variable_declaration: {
    kind: 'constant',
    topLevel: true,
    name: ['variable_declarator', 'name'],
    requires: { path: ['variable_declarator', 'name'], types: ['identifier'] },
    refine: [{ kind: 'function', value: { path: ['variable_declarator', 'value'], types: ['arrow_function', 'function_expression', 'function'] } }]
  }
}

function jsGrammar(wasm: string, extensions: string[]): Grammar {
  return {
    wasm,
    family: 'js',
    extensions,
    decls: JS_DECLS,
    scopes: {},
    wrappers: ['export_statement'],
    bodies: ['class_body'],
    nameTypes: ['identifier', 'type_identifier', 'property_identifier'],
    refs: {
      identifier: 'name',
      type_identifier: 'name',
      shorthand_property_identifier: 'name',
      property_identifier: 'member'
    },
    memberParents: [],
    leading: ['comment'],
    decorators: ['decorator'],
    tests: {},
    special: { expression_statement: jsCallSymbol }
  }
}

export const GRAMMARS: Grammar[] = [
  jsGrammar('typescript', ['.ts', '.mts', '.cts']),
  jsGrammar('tsx', ['.tsx']),
  jsGrammar('javascript', ['.js', '.jsx', '.mjs', '.cjs']),
  {
    wasm: 'python',
    family: 'py',
    extensions: ['.py'],
    decls: {
      function_definition: { kind: 'function' },
      class_definition: { kind: 'class', members: true },
      expression_statement: {
        kind: 'constant',
        topLevel: true,
        name: ['assignment', 'left'],
        requires: { path: ['assignment', 'left'], types: ['identifier'] }
      }
    },
    scopes: {},
    wrappers: ['decorated_definition'],
    bodies: ['block'],
    nameTypes: ['identifier'],
    refs: { identifier: 'name' },
    memberParents: ['attribute'],
    leading: ['comment'],
    decorators: ['decorator'],
    tests: { names: /^test_/ },
    special: { if_statement: pythonMainBlock }
  },
  {
    wasm: 'kotlin',
    family: 'jvm',
    extensions: ['.kt', '.kts'],
    decls: {
      class_declaration: {
        kind: 'class',
        members: true,
        refine: [
          { kind: 'interface', keyword: 'interface' },
          { kind: 'enum', child: 'enum_class_body' }
        ]
      },
      object_declaration: { kind: 'class', members: true },
      function_declaration: { kind: 'function' },
      property_declaration: { kind: 'constant', topLevel: true, name: ['variable_declaration'] },
      type_alias: { kind: 'type' }
    },
    scopes: { companion_object: null },
    wrappers: [],
    bodies: ['class_body', 'enum_class_body'],
    nameTypes: ['simple_identifier', 'type_identifier'],
    refs: { simple_identifier: 'name', type_identifier: 'name' },
    memberParents: ['navigation_suffix'],
    leading: ['comment', 'line_comment', 'multiline_comment'],
    decorators: ['annotation'],
    tests: { decorators: /^Test$/ },
    special: {}
  },
  {
    wasm: 'java',
    family: 'jvm',
    extensions: ['.java'],
    decls: {
      class_declaration: { kind: 'class', members: true },
      record_declaration: { kind: 'class', members: true },
      interface_declaration: { kind: 'interface' },
      enum_declaration: { kind: 'enum' },
      method_declaration: { kind: 'function' }
    },
    scopes: {},
    wrappers: [],
    bodies: ['class_body'],
    nameTypes: ['identifier'],
    refs: { identifier: 'name', type_identifier: 'name' },
    memberParents: [],
    leading: ['line_comment', 'block_comment'],
    decorators: ['marker_annotation', 'annotation'],
    tests: { decorators: /^Test$/ },
    special: {}
  },
  {
    wasm: 'go',
    family: 'go',
    extensions: ['.go'],
    decls: {
      function_declaration: { kind: 'function' },
      method_declaration: { kind: 'method', qualifier: ['receiver', 'parameter_declaration', 'type'] },
      type_declaration: {
        kind: 'type',
        name: ['type_spec|type_alias', 'name'],
        refine: [{ kind: 'interface', value: { path: ['type_spec', 'type'], types: ['interface_type'] } }]
      },
      const_declaration: { kind: 'constant', name: ['const_spec', 'name'] },
      var_declaration: { kind: 'constant', name: ['var_spec', 'name'] }
    },
    scopes: {},
    wrappers: [],
    bodies: [],
    nameTypes: ['identifier', 'type_identifier', 'field_identifier'],
    refs: { identifier: 'name', type_identifier: 'name', field_identifier: 'member' },
    memberParents: [],
    leading: ['comment'],
    decorators: [],
    tests: { names: /^Test[A-Z0-9_]/ },
    special: {}
  },
  {
    wasm: 'swift',
    family: 'swift',
    extensions: ['.swift'],
    decls: {
      class_declaration: { kind: 'class', members: true, refine: [{ kind: 'enum', child: 'enum_class_body' }] },
      protocol_declaration: { kind: 'interface' },
      function_declaration: { kind: 'function' },
      property_declaration: { kind: 'constant', topLevel: true, name: ['name'] },
      typealias_declaration: { kind: 'type' }
    },
    scopes: {},
    wrappers: [],
    bodies: ['class_body', 'enum_class_body'],
    nameTypes: ['simple_identifier', 'type_identifier'],
    refs: { simple_identifier: 'name', type_identifier: 'name' },
    memberParents: ['navigation_suffix'],
    leading: ['comment', 'multiline_comment'],
    decorators: ['attribute'],
    tests: { names: /^test/ },
    special: {}
  },
  {
    wasm: 'rust',
    family: 'rust',
    extensions: ['.rs'],
    decls: {
      function_item: { kind: 'function' },
      struct_item: { kind: 'type' },
      enum_item: { kind: 'enum' },
      trait_item: { kind: 'interface' },
      type_item: { kind: 'type' },
      const_item: { kind: 'constant' },
      static_item: { kind: 'constant' }
    },
    scopes: { impl_item: ['type'] },
    wrappers: [],
    bodies: ['declaration_list'],
    nameTypes: ['identifier', 'type_identifier'],
    refs: { identifier: 'name', type_identifier: 'name', field_identifier: 'member' },
    memberParents: [],
    leading: ['line_comment', 'block_comment', 'attribute_item'],
    decorators: ['attribute_item'],
    tests: { decorators: /^test$/ },
    special: {}
  },
  {
    wasm: 'ruby',
    family: 'ruby',
    extensions: ['.rb'],
    decls: {
      method: { kind: 'function' },
      singleton_method: { kind: 'function' },
      class: { kind: 'class', members: true },
      module: { kind: 'class', members: true },
      assignment: { kind: 'constant', topLevel: true, name: ['left'], requires: { path: ['left'], types: ['constant'] } }
    },
    scopes: {},
    wrappers: [],
    bodies: ['body_statement'],
    nameTypes: ['identifier', 'constant'],
    refs: { identifier: 'name', constant: 'name' },
    memberParents: [],
    leading: ['comment'],
    decorators: [],
    tests: {},
    special: {}
  }
]

export function grammarFor(path: string): Grammar | null {
  const lower = path.toLowerCase()
  for (const grammar of GRAMMARS) {
    for (const extension of grammar.extensions) {
      if (lower.endsWith(extension)) return grammar
    }
  }
  return null
}
