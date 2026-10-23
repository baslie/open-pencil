import {
  generateId,
  type Effect,
  type Fill,
  type LayoutAlign,
  type LayoutCounterAlign,
  type LayoutMode,
  type LayoutSizing,
  type NodeType,
  type SceneGraph,
  type SceneNode,
  type Stroke,
  type StrokeCap,
  type StrokeJoin,
  type TextAlignVertical,
  type Variable,
  type VariableCollection,
  type VariableCollectionMode,
  type VariableType,
  type VariableValue
} from '@open-pencil/scene-graph'
import { parseColor } from '@open-pencil/scene-graph/color'
import { BLACK } from '@open-pencil/scene-graph/constants'
import {
  paddingFromShorthand,
  parseAutoLayoutDirection,
  parseCounterAxisAlign,
  parsePrimaryAxisAlign
} from '@open-pencil/scene-graph/layout'
import type { Color, Vector } from '@open-pencil/scene-graph/primitives'

export interface PenDocument {
  version: string
  children: PenNode[]
  themes?: Record<string, string[]>
  variables?: Record<string, PenVariable>
}

export interface PenVariable {
  type: 'color' | 'string' | 'number'
  value: PenVariableValue[] | PenVariableValue | string | number
}

interface PenVariableValue {
  value: string | number
  theme?: Record<string, string>
}

type PenSides<T> = { top?: T; right?: T; bottom?: T; left?: T }

/** Stroke object of early `.pen` files; schema 2.x splits it into `stroke` and `stroke*` fields. */
interface PenLegacyStroke {
  align: 'inside' | 'center' | 'outside'
  thickness: number | PenSides<number>
  fill?: string
  join?: string
  cap?: string
}

interface PenEffect {
  type: string
  shadowType?: string
  color?: string
  offset?: Vector
  blur?: number
  spread?: number
}

interface PenFillObject {
  type: string
  color: string
  enabled?: boolean
}

type PenFill = string | PenFillObject | PenFillObject[]
type PenStrokeWidth = number | string | PenSides<number | string>
type PenSpacingValue = number | string
type PenPadding =
  | PenSpacingValue
  | [PenSpacingValue, PenSpacingValue]
  | [PenSpacingValue, PenSpacingValue, PenSpacingValue, PenSpacingValue]

export interface PenNode {
  type: string
  id: string
  name?: string
  x?: number
  y?: number
  width?: number | string
  height?: number | string
  fill?: PenFill
  opacity?: number
  enabled?: boolean
  clip?: boolean
  rotation?: number
  flipX?: boolean
  flipY?: boolean
  reusable?: boolean
  cornerRadius?: number | string | (number | string)[]
  /** A fill or list of fills in schema 2.x; the legacy object form is still read. */
  stroke?: PenFill | PenLegacyStroke
  strokeWidth?: PenStrokeWidth
  strokeAlignment?: string
  strokeLinecap?: string
  strokeLinejoin?: string
  effect?: PenEffect | PenEffect[]
  layout?: string
  gap?: number | string
  padding?: PenPadding
  justifyContent?: string
  alignItems?: string
  children?: PenNode[]
  content?: string
  fontFamily?: string
  fontSize?: number
  fontWeight?: string | number
  lineHeight?: number
  letterSpacing?: number
  textAlign?: string
  textAlignVertical?: string
  textGrowth?: string
  ref?: string
  descendants?: Record<string, Partial<PenNode>>
  slot?: string[]
  geometry?: string
  iconFontName?: string
  iconFontFamily?: string
  weight?: number
  model?: string
  theme?: Record<string, string>
}

export interface VarContext {
  byName: Map<string, { id: string; variable: Variable }>
  activeModeId: string
  collectionId: string
  modeByThemeName: Map<string, string>
  resolveColor(ref: string): Color
  resolveNumber(ref: string): number
  resolveString(ref: string): string
  setActiveTheme(themeName: string): void
}

function penVarTypeToSceneType(t: string): VariableType {
  if (t === 'color') return 'COLOR'
  if (t === 'number') return 'FLOAT'
  return 'STRING'
}

function penValueToSceneValue(raw: string | number, type: VariableType): VariableValue {
  if (type === 'COLOR' && typeof raw === 'string') return parseColor(raw)
  if (type === 'FLOAT' && typeof raw === 'number') return raw
  if (type === 'STRING') return String(raw)
  if (typeof raw === 'number') return raw
  return String(raw)
}

function defaultForType(type: VariableType): VariableValue {
  if (type === 'COLOR') return { ...BLACK }
  if (type === 'FLOAT') return 0
  if (type === 'BOOLEAN') return false
  return ''
}

export function isVarRef(val: unknown): val is string {
  return typeof val === 'string' && val.startsWith('$') && val.length > 1
}

function varName(ref: string): string {
  return ref.replace(/^\$/, '')
}

export function bindIfVar(node: SceneNode, field: string, val: unknown, ctx: VarContext): void {
  if (!isVarRef(val)) return
  const entry = ctx.byName.get(varName(val))
  if (entry) node.boundVariables[field] = entry.id
}

export function buildVarContext(
  graph: SceneGraph,
  penVars: Record<string, PenVariable>,
  themes: Record<string, string[]>
): VarContext {
  const collectionId = generateId()
  const modes: VariableCollectionMode[] = []
  const themeKeys = Object.keys(themes)

  if (themeKeys.length > 0) {
    const themeKey = themeKeys[0]
    for (const modeName of themes[themeKey]) {
      modes.push({ modeId: generateId(), name: modeName })
    }
  }
  if (modes.length === 0) {
    modes.push({ modeId: generateId(), name: 'Default' })
  }

  const collection: VariableCollection = {
    id: collectionId,
    name: 'Variables',
    modes,
    defaultModeId: modes[0].modeId,
    variableIds: []
  }
  graph.addCollection(collection)

  const modeByThemeValue = new Map<string, string>()
  if (themeKeys.length > 0) {
    const themeKey = themeKeys[0]
    for (const mode of modes) {
      modeByThemeValue.set(`${themeKey}:${mode.name}`, mode.modeId)
    }
  }

  const byName = new Map<string, { id: string; variable: Variable }>()

  for (const [name, def] of Object.entries(penVars)) {
    const varId = generateId()
    const varType = penVarTypeToSceneType(def.type)
    const valuesByMode: Record<string, VariableValue> = {}

    if (Array.isArray(def.value)) {
      for (const entry of def.value) {
        if (entry.theme) {
          const [tKey, tVal] = Object.entries(entry.theme)[0]
          const modeId = modeByThemeValue.get(`${tKey}:${tVal}`)
          if (modeId) valuesByMode[modeId] = penValueToSceneValue(entry.value, varType)
        } else {
          valuesByMode[modes[0].modeId] = penValueToSceneValue(entry.value, varType)
        }
      }
    } else {
      valuesByMode[modes[0].modeId] = penValueToSceneValue(def.value as string | number, varType)
    }

    for (const mode of modes) {
      if (!(mode.modeId in valuesByMode)) {
        valuesByMode[mode.modeId] = valuesByMode[modes[0].modeId] ?? defaultForType(varType)
      }
    }

    const variable: Variable = {
      id: varId,
      name,
      type: varType,
      collectionId,
      valuesByMode,
      description: '',
      hiddenFromPublishing: false
    }
    graph.addVariable(variable)
    byName.set(name, { id: varId, variable })
  }

  let activeModeId = modes[0].modeId

  function resolveVal(ref: string): VariableValue | undefined {
    const entry = byName.get(ref.replace(/^\$/, ''))
    if (!entry) return undefined
    return (
      entry.variable.valuesByMode[activeModeId] ?? Object.values(entry.variable.valuesByMode)[0]
    )
  }

  return {
    byName,
    activeModeId,
    collectionId,
    modeByThemeName: modeByThemeValue,
    resolveColor(ref: string): Color {
      const val = resolveVal(ref)
      if (val === undefined) return parseColor(ref)
      if (typeof val === 'object' && 'r' in val) return val
      if (typeof val === 'string') return parseColor(val)
      return { ...BLACK }
    },
    resolveNumber(ref: string): number {
      const val = resolveVal(ref)
      return typeof val === 'number' ? val : 0
    },
    resolveString(ref: string): string {
      const val = resolveVal(ref)
      return typeof val === 'string' ? val : ''
    },
    setActiveTheme(themeName: string) {
      const modeId = modeByThemeValue.get(`theme:${themeName}`)
      if (modeId) {
        activeModeId = modeId
        graph.activeMode.set(collectionId, modeId)
      }
    }
  }
}

function parseFillColor(fill: string | PenFillObject, ctx: VarContext): Color {
  const raw = typeof fill === 'string' ? fill : fill.color
  return isVarRef(raw) ? ctx.resolveColor(raw) : parseColor(raw)
}

export function convertFill(fill: PenFill | undefined, ctx: VarContext, node?: SceneNode): Fill[] {
  if (fill === undefined) return []
  const fills = Array.isArray(fill) ? fill : [fill]
  return fills.map((item, index) => {
    const visible = typeof item === 'string' ? true : item.enabled !== false
    const color = parseFillColor(item, ctx)
    const result: Fill = { type: 'SOLID', visible, opacity: color.a, color }
    if (node) bindIfVar(node, `fills[${index}]`, typeof item === 'string' ? item : item.color, ctx)
    return result
  })
}

type PenStrokeFields = Pick<
  PenNode,
  'stroke' | 'strokeWidth' | 'strokeAlignment' | 'strokeLinecap' | 'strokeLinejoin'
>

const STROKE_KEYS = [
  'stroke',
  'strokeWidth',
  'strokeAlignment',
  'strokeLinecap',
  'strokeLinejoin'
] as const satisfies (keyof PenStrokeFields)[]

/** Stroke fields of an instance over those of its component: each field overrides on its own. */
export function mergeStrokeFields(base: PenStrokeFields, over: PenStrokeFields): PenStrokeFields {
  const merged: PenStrokeFields = {}
  for (const key of STROKE_KEYS) {
    const value = over[key] ?? base[key]
    if (value !== undefined) Object.assign(merged, { [key]: value })
  }
  return merged
}

interface StrokeGeometry {
  paints: PenFill
  width: PenStrokeWidth | undefined
  align: Stroke['align']
  join?: string
  cap?: string
}

const LEGACY_ALIGN: Record<string, Stroke['align']> = { inside: 'INSIDE', outside: 'OUTSIDE' }
const ALIGN: Record<string, Stroke['align']> = { inner: 'INSIDE', outer: 'OUTSIDE' }

function isLegacyStroke(stroke: PenNode['stroke']): stroke is PenLegacyStroke {
  return typeof stroke === 'object' && !Array.isArray(stroke) && 'thickness' in stroke
}

function strokeGeometry(pen: PenStrokeFields): StrokeGeometry | undefined {
  const { stroke } = pen
  if (stroke === undefined) return undefined
  if (!isLegacyStroke(stroke)) {
    return {
      paints: stroke,
      width: pen.strokeWidth,
      align: ALIGN[pen.strokeAlignment ?? ''] ?? 'CENTER',
      join: pen.strokeLinejoin,
      cap: pen.strokeLinecap
    }
  }
  if (!stroke.fill) return undefined
  return {
    paints: stroke.fill,
    width: stroke.thickness,
    align: LEGACY_ALIGN[stroke.align] ?? 'CENTER',
    join: stroke.join,
    cap: stroke.cap
  }
}

function strokeSides(
  width: PenStrokeWidth | undefined,
  ctx: VarContext
): Required<PenSides<number>> | undefined {
  if (typeof width !== 'object') return undefined
  const side = (value: number | string | undefined) => parseSize(value, 0, ctx).value
  return {
    top: side(width.top),
    right: side(width.right),
    bottom: side(width.bottom),
    left: side(width.left)
  }
}

/**
 * Schema 2.x: `stroke` is a fill or a list of fills, the width is `strokeWidth` (uniform or per
 * side) and the alignment is `strokeAlignment`. Without a width the stroke is not drawn.
 */
export function convertStroke(pen: PenStrokeFields, ctx: VarContext, node?: SceneNode): Stroke[] {
  const geometry = strokeGeometry(pen)
  if (!geometry) return []
  const { paints, width, align } = geometry
  const sides = strokeSides(width, ctx)
  const weight = sides
    ? Math.max(...Object.values(sides))
    : parseSize(typeof width === 'object' ? undefined : width, 0, ctx).value
  if (!(weight > 0)) return []

  const strokes = convertFill(paints, ctx).map((fill): Stroke => ({
    ...fill,
    weight,
    align,
    dashPattern: []
  }))
  if (node) {
    const items = Array.isArray(paints) ? paints : [paints]
    items.forEach((item, index) => {
      bindIfVar(node, `strokes[${index}]`, typeof item === 'string' ? item : item.color, ctx)
    })
    if (sides) {
      node.independentStrokeWeights = true
      node.borderTopWeight = sides.top
      node.borderRightWeight = sides.right
      node.borderBottomWeight = sides.bottom
      node.borderLeftWeight = sides.left
    }
    node.strokeWeight = weight
    node.strokeAlign = align
    node.strokeJoin = mapStrokeJoin(geometry.join)
    node.strokeCap = mapStrokeCap(geometry.cap)
  }
  return strokes
}

function mapStrokeJoin(join: string | undefined): StrokeJoin {
  if (join === 'round') return 'ROUND'
  if (join === 'bevel') return 'BEVEL'
  return 'MITER'
}

function mapStrokeCap(cap: string | undefined): StrokeCap {
  if (cap === 'round') return 'ROUND'
  if (cap === 'square') return 'SQUARE'
  return 'NONE'
}

export function convertEffects(effect: PenEffect | PenEffect[] | undefined): Effect[] {
  if (!effect) return []
  const effects = Array.isArray(effect) ? effect : [effect]
  return effects.flatMap((item) => {
    if (item.type !== 'shadow') return []
    const color = item.color ? parseColor(item.color) : { r: 0, g: 0, b: 0, a: 0.25 }
    return [
      {
        type: item.shadowType === 'inner' ? 'INNER_SHADOW' : 'DROP_SHADOW',
        visible: true,
        blendMode: 'NORMAL',
        color,
        offset: item.offset ?? { x: 0, y: 0 },
        radius: item.blur ?? 0,
        spread: item.spread ?? 0
      } satisfies Effect
    ]
  })
}

export function applyCornerRadius(
  node: SceneNode,
  radius: PenNode['cornerRadius'],
  ctx: VarContext
): void {
  if (radius === undefined) return
  if (Array.isArray(radius)) {
    const values = radius.map((value) => parseSize(value, 0, ctx).value)
    node.independentCorners = true
    node.topLeftRadius = values[0] ?? 0
    node.topRightRadius = values[1] ?? 0
    node.bottomRightRadius = values[2] ?? 0
    node.bottomLeftRadius = values[3] ?? 0
    return
  }
  node.cornerRadius = parseSize(radius, 0, ctx).value
}

export function applyPadding(node: SceneNode, padding: PenNode['padding'], ctx?: VarContext): void {
  if (padding === undefined) return
  const resolve = (v: number | string): number =>
    typeof v === 'string' ? (isVarRef(v) && ctx ? ctx.resolveNumber(v) : Number(v) || 0) : v
  Object.assign(
    node,
    paddingFromShorthand(Array.isArray(padding) ? padding.map(resolve) : [resolve(padding)])
  )
}

interface ParsedSize {
  value: number
  sizing: LayoutSizing
  /** Fallback used only when fit_content(N) has no children. */
  fitContentFallback?: number
}

function parseParameterizedFallback(value: string, behavior: string): number | undefined {
  const prefix = `${behavior}(`
  if (!value.startsWith(prefix) || !value.endsWith(')')) return undefined

  const rawFallback = value.slice(prefix.length, -1).trim()
  if (rawFallback === '') return undefined

  const parsedFallback = Number(rawFallback)
  return Number.isFinite(parsedFallback) ? parsedFallback : undefined
}

function parseSizingBehavior(value: string, fallback: number): ParsedSize | undefined {
  if (value === 'fill_container') return { value: fallback, sizing: 'FILL' }
  if (value === 'fit_content') return { value: fallback, sizing: 'HUG' }

  // Older generated .pen files used hug_content as an alias for fit_content.
  if (value === 'hug_content') return { value: fallback, sizing: 'HUG' }

  const fillFallback = parseParameterizedFallback(value, 'fill_container')
  if (fillFallback !== undefined) return { value: fillFallback, sizing: 'FILL' }

  const fitFallback =
    parseParameterizedFallback(value, 'fit_content') ??
    parseParameterizedFallback(value, 'hug_content')
  if (fitFallback !== undefined) {
    return { value: fitFallback, sizing: 'HUG', fitContentFallback: fitFallback }
  }
  return undefined
}

export function parseSize(
  value: number | string | undefined,
  fallback: number,
  ctx?: VarContext
): ParsedSize {
  if (value === undefined) return { value: fallback, sizing: 'FIXED' }
  if (typeof value === 'number') return { value, sizing: 'FIXED' }

  const behavior = parseSizingBehavior(value, fallback)
  if (behavior) return behavior

  if (isVarRef(value) && ctx) return { value: ctx.resolveNumber(value), sizing: 'FIXED' }
  const parsed = Number(value)
  return { value: Number.isFinite(parsed) ? parsed : fallback, sizing: 'FIXED' }
}

export function mapLayoutMode(pen: PenNode): LayoutMode {
  const direction = parseAutoLayoutDirection(pen.layout)
  if (direction) return direction
  return pen.type === 'frame' && pen.layout === undefined ? 'HORIZONTAL' : 'NONE'
}

export function mapJustifyContent(value: string | undefined): LayoutAlign {
  return parsePrimaryAxisAlign(value) ?? 'MIN'
}

export function mapAlignItems(value: string | undefined): LayoutCounterAlign {
  return parseCounterAxisAlign(value) ?? 'MIN'
}

export function mapTextAlign(value: string | undefined): SceneNode['textAlignHorizontal'] {
  if (value === 'center') return 'CENTER'
  if (value === 'right' || value === 'end') return 'RIGHT'
  if (value === 'justified') return 'JUSTIFIED'
  return 'LEFT'
}

export function mapTextAlignVertical(value: string | undefined): TextAlignVertical {
  if (value === 'center') return 'CENTER'
  if (value === 'bottom' || value === 'end') return 'BOTTOM'
  return 'TOP'
}

export function mapFontWeight(value: string | number | undefined): number {
  if (typeof value === 'number') return value
  if (value === 'thin') return 100
  if (value === 'extralight') return 200
  if (value === 'light') return 300
  if (value === 'medium') return 500
  if (value === 'semibold') return 600
  if (value === 'bold') return 700
  if (value === 'extrabold') return 800
  if (value === 'black') return 900
  return 400
}

export function mapNodeType(pen: PenNode): NodeType {
  if (pen.type === 'frame') return pen.reusable ? 'COMPONENT' : 'FRAME'
  if (pen.type === 'rectangle') return 'RECTANGLE'
  if (pen.type === 'ellipse') return 'ELLIPSE'
  if (pen.type === 'text' || pen.type === 'icon_font') return 'TEXT'
  if (pen.type === 'path') return 'VECTOR'
  if (pen.type === 'ref') return 'INSTANCE'
  return 'FRAME'
}
