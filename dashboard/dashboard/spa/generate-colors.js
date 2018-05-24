/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';

tr.exportTo('cp', () => {
  /**
   * Generate pretty colors!
   * http://basecase.org/env/on-rainbows
   * https://mycarta.wordpress.com/2012/10/06/the-rainbow-is-deadlong-live-the-rainbow-part-3/
   *
   * Set brightnessPct = 0 to always generate black.
   * Set brightnessPct = 1 to always generate white.
   * Set brightnessPct = .5 to generate saturated colors.
   *
   * @param {number} huePct
   * @param {number} brightnessPct
   * @return {!tr.b.Color}
   */
  function sinebowColor(huePct, brightnessPct) {
    // TODO smooth huePct using spline
    const h = -(huePct + .5);
    let r = Math.sin(Math.PI * h);
    let g = Math.sin(Math.PI * (h + 1 / 3));
    let b = Math.sin(Math.PI * (h + 2 / 3));
    r *= r;
    g *= g;
    b *= b;

    // Roughly correct for human perception.
    // https://en.wikipedia.org/wiki/Luma_%28video%29
    // Multiply by 2 to normalize all values to 0.5.
    // (Halfway between black and white.)
    const y = 2 * (0.2989 * r + 0.5870 * g + 0.1140 * b);
    r /= y;
    g /= y;
    b /= y;

    if (brightnessPct <= 0.5) {
      r *= brightnessPct * 2;
      g *= brightnessPct * 2;
      b *= brightnessPct * 2;
    } else {
      const brightness = tr.b.math.normalize(brightnessPct, .5, 1);
      r = tr.b.math.lerp(brightness, r, 1);
      g = tr.b.math.lerp(brightness, g, 1);
      b = tr.b.math.lerp(brightness, b, 1);
    }
    r *= 256;
    g *= 256;
    b *= 256;
    r = Math.round(r);
    g = Math.round(g);
    b = Math.round(b);
    return new tr.b.Color(r, g, b);
  }

  /**
   * Compute a given number of colors by evenly spreading them around the
   * sinebow hue circle, or, if a Range of brightnesses is given, the hue x
   * brightness cylinder.
   *
   * @param {Number} numColors
   * @param {!Range} opt_options.brightnessRange
   * @param {Number} opt_options.brightnessPct
   * @param {Number} opt_options.hueOffset
   * @return {!Array.<!tr.b.Color>}
   */
  function generateColors(numColors, opt_options) {
    const options = opt_options || {};
    const brightnessRange = options.brightnessRange;
    const hueOffset = options.hueOffset || 0;
    const colors = [];
    if (numColors > 15 && brightnessRange) {
      // Evenly spread numColors around the surface of the hue x brightness
      // cylinder. Maximize distance between (huePct, brightnessPct) vectors.
      const numCycles = Math.round(numColors / 15);
      for (let i = 0; i < numCycles; ++i) {
        colors.push.apply(colors, generateColors(15, {
          brightnessPct: brightnessRange.lerp(i / (numCycles - 1)),
        }));
      }
    } else {
      // Evenly spread numColors throughout the sinebow hue circle.
      const brightnessPct = (options.brightnessPct === undefined) ? 0.5 :
        options.brightnessPct;
      for (let i = 0; i < numColors; ++i) {
        const huePct = hueOffset + (i / numColors);
        colors.push(sinebowColor(huePct, brightnessPct));
      }
    }
    return colors;
  }

  return {
    generateColors,
  };
});
