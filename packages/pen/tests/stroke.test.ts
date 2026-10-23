import { describe, expect, test } from 'bun:test'

import { parsePenFile, type PenDocument, type PenNode } from '@open-pencil/pen'

const BLACK = { r: 0, g: 0, b: 0, a: 1 }
const RED = { r: 1, g: 0, b: 0, a: 1 }

function parseFrame(fields: Partial<PenNode>, variables: PenDocument['variables'] = {}) {
  const document: PenDocument = {
    version: '2.21',
    variables,
    children: [{ id: 'a', type: 'frame', width: 10, height: 10, ...fields }]
  }
  return parsePenFile(JSON.stringify(document)).getNode('a')
}

describe('2.x strokes', () => {
  test('reads a color stroke with strokeWidth and strokeAlignment', () => {
    const node = parseFrame({ stroke: '#000000', strokeWidth: 2, strokeAlignment: 'inner' })

    expect(node?.strokes).toHaveLength(1)
    expect(node?.strokes[0]).toMatchObject({ color: BLACK, weight: 2, align: 'INSIDE' })
  })

  test('reads every fill of a stroke list', () => {
    const node = parseFrame({
      stroke: [
        { type: 'color', color: '#000000' },
        { type: 'color', color: '#FF0000', enabled: false }
      ],
      strokeWidth: 1,
      strokeAlignment: 'outer'
    })

    expect(node?.strokes.map((stroke) => [stroke.color, stroke.visible, stroke.align])).toEqual([
      [BLACK, true, 'OUTSIDE'],
      [RED, false, 'OUTSIDE']
    ])
  })

  test('centers a stroke without strokeAlignment', () => {
    expect(parseFrame({ stroke: '#000000', strokeWidth: 1 })?.strokes[0]?.align).toBe('CENTER')
  })

  test('maps per-side widths to border weights', () => {
    const node = parseFrame({ stroke: '#000000', strokeWidth: { top: 1, bottom: 3 } })

    expect(node?.strokes[0]?.weight).toBe(3)
    expect(node).toMatchObject({
      independentStrokeWeights: true,
      borderTopWeight: 1,
      borderRightWeight: 0,
      borderBottomWeight: 3,
      borderLeftWeight: 0
    })
  })

  test('draws no stroke without a width', () => {
    expect(parseFrame({ stroke: '#000000' })?.strokes).toEqual([])
  })

  test('resolves and binds variable colors and widths', () => {
    const node = parseFrame(
      { stroke: '$border', strokeWidth: '$hairline' },
      {
        border: { type: 'color', value: '#FF0000' },
        hairline: { type: 'number', value: 2 }
      }
    )

    expect(node?.strokes[0]).toMatchObject({ color: RED, weight: 2 })
    expect(Object.keys(node?.boundVariables ?? {})).toEqual(['strokes[0]'])
  })

  test('maps line caps and joins', () => {
    const node = parseFrame({
      stroke: '#000000',
      strokeWidth: 1,
      strokeLinecap: 'round',
      strokeLinejoin: 'bevel'
    })

    expect(node).toMatchObject({ strokeCap: 'ROUND', strokeJoin: 'BEVEL' })
  })

  test('lets an instance override the stroke color and keep the component width', () => {
    const document: PenDocument = {
      version: '2.21',
      children: [
        {
          id: 'card',
          type: 'frame',
          reusable: true,
          width: 10,
          height: 10,
          stroke: '#000000',
          strokeWidth: 2,
          strokeAlignment: 'inner'
        },
        { id: 'copy', type: 'ref', ref: 'card', stroke: '#FF0000' }
      ]
    }
    const node = parsePenFile(JSON.stringify(document)).getNode('copy')

    expect(node?.strokes[0]).toMatchObject({ color: RED, weight: 2, align: 'INSIDE' })
  })

  test('still reads the legacy stroke object', () => {
    const node = parseFrame({ stroke: { align: 'inside', thickness: 2, fill: '#000000' } })

    expect(node?.strokes[0]).toMatchObject({ color: BLACK, weight: 2, align: 'INSIDE' })
  })
})
