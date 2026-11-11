import { describe, expect, it } from 'vitest'
import { checkPage, stripScriptContents } from '../scripts/check-build-output.mjs'

/**
 * scripts/check-build-output.mjs is the guard against course and instructor
 * pages shipping as an empty loading shell again. These are the shapes that
 * would slip past a naive check.
 */

const course = { jsonLd: true, ogImage: true }

const goodCourse = `<!DOCTYPE html><html><head>
<meta property="og:image" content="https://stanfordroot.com/opengraph-image?3c78107cc46970e4"/>
</head><body>
<script type="application/ld+json">{"@type":"Course","name":"CS 106B"}</script>
<section class="sr-only"><h1 class="text-2xl">CS 106B: Programming Abstractions</h1></section>
<a href="/CS106A">CS 106A</a>
</body></html>`

describe('checkPage', () => {
  it('passes a server-rendered course page', () => {
    expect(checkPage(goodCourse, course)).toEqual([])
  })

  it('fails the client-rendering bailout shell, whose text lives only in the RSC payload', () => {
    // What live /CS106B looked like: the visible document is a template marker,
    // and the h1, links and JSON-LD exist only as strings inside <script> tags.
    const shell = `<!DOCTYPE html><html><head></head><body>
<template data-dgst="BAILOUT_TO_CLIENT_SIDE_RENDERING"></template>
<script>self.__next_f.push([1,"<h1>CS 106B</h1><a href=\\"/CS106A\\">x</a><script type=\\"application/ld+json\\">{}</script><meta property=\\"og:image\\" content=\\"x\\">"])</script>
</body></html>`
    expect(checkPage(shell, course)).toEqual([
      'no <h1>',
      'no <a href>',
      'no application/ld+json script tag',
      'no og:image',
    ])
  })

  it('requires JSON-LD on the course page', () => {
    const html = goodCourse.replace(/<script type="application\/ld\+json">.*?<\/script>/, '')
    expect(checkPage(html, course)).toEqual(['no application/ld+json script tag'])
  })

  it('requires a non-empty og:image', () => {
    expect(checkPage(goodCourse.replace(/content="https[^"]*"/, 'content=""'), course)).toEqual(['no og:image'])
    expect(checkPage(goodCourse.replace('og:image', 'og:image:alt'), course)).toEqual(['no og:image'])
  })

  it('accepts og:image with its attributes in either order', () => {
    const html = goodCourse.replace(
      /<meta property="og:image" content="([^"]*)"\/>/,
      '<meta content="$1" property="og:image"/>',
    )
    expect(checkPage(html, course)).toEqual([])
  })

  it('does not count an anchor without an href, or an empty href', () => {
    const noHref = goodCourse.replace('<a href="/CS106A">', '<a>')
    expect(checkPage(noHref, course)).toEqual(['no <a href>'])
    const emptyHref = goodCourse.replace('<a href="/CS106A">', '<a href="">')
    expect(checkPage(emptyHref, course)).toEqual(['no <a href>'])
  })

  it('does not mistake <header> or <hr> for an h1', () => {
    const html = goodCourse.replace(/<h1[^>]*>.*?<\/h1>/, '<header>Stanford Root</header><hr>')
    expect(checkPage(html, course)).toEqual(['no <h1>'])
  })

  it('skips JSON-LD and og:image for pages that do not ask for them', () => {
    const about = '<html><body><h1>About</h1><a href="/">Home</a></body></html>'
    expect(checkPage(about)).toEqual([])
  })
})

describe('stripScriptContents', () => {
  it('empties every script, including multi-line ones, but keeps the tags', () => {
    expect(stripScriptContents('<script>a\n<h1>b</h1></script><p>c</p><SCRIPT type="x">d</SCRIPT>'))
      .toBe('<script></script><p>c</p><SCRIPT type="x"></SCRIPT>')
  })
})
