export function clipCSS(coords) {

  if (coords.length < 3) return 'none'

  return 'polygon' + '(' + clipPoints(coords).join(', ') + ')'
}

export function clipPoints(coords) {
  return coords.map(i => {
    return i.map(o => {
      return o + '%'
    }).join(' ')
  })
}
