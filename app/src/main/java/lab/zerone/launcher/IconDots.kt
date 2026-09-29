package lab.zerone.launcher

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.drawable.Drawable
import org.json.JSONArray
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.max

/**
 * Renders a launcher icon down to the dot grid, as rows in the same `bmp2` alphabet the
 * hand-drawn glyphs in icons.js use: `X` main, `*` accent, `+` dim, `.` off.
 *
 * Three things make the difference between a recognisable icon and a grey smudge at 20x20:
 *
 *  - **Supersample, then box-average.** Asking a Drawable to draw itself straight into a 20px
 *    canvas gives you whatever its own scaler does at that size, which for a detailed icon is
 *    mostly noise. Rendering large and averaging each cell is what turns fine detail into an
 *    honest mid-tone instead of a coin flip.
 *  - **Trim the padding.** Adaptive icons reserve a wide safe zone that is pure background;
 *    keeping it spends a third of the grid's diameter on nothing. Cropping to the visible
 *    bounds first is most of the perceived resolution gain.
 *  - **Normalise per icon.** Absolute luminance thresholds render a dark icon as an empty
 *    square and a light one as a solid block. Scaling to each icon's own brightest cell keeps
 *    both readable, which matters because the grid has four levels to play with and no colour.
 *
 * Composited over black on purpose: that is what the panel actually is, so a translucent icon
 * resolves to the brightness it will really appear at.
 */
object IconDots {

    private const val RENDER = 96          // supersample resolution before box-averaging
    private const val ALPHA_FLOOR = 8      // below this a pixel is "not part of the icon"

    private val cache = ConcurrentHashMap<String, String>()

    /** Cached JSON array of row strings, or `[]` if the icon cannot be loaded. */
    fun encode(ctx: Context, pkg: String, size: Int): String {
        cache[pkg]?.let { return it }
        val out = try {
            build(ctx, pkg, size)
        } catch (e: Throwable) {
            android.util.Log.w("ZrnIcon", "icon encode failed for $pkg: ${e.message}")
            "[]"
        }
        cache[pkg] = out
        return out
    }

    /** Package replaced or updated — its icon may have changed. */
    fun invalidate(pkg: String) { cache.remove(pkg) }

    fun invalidateAll() = cache.clear()

    private fun build(ctx: Context, pkg: String, size: Int): String {
        val d: Drawable = ctx.packageManager.getApplicationIcon(pkg)

        val bmp = Bitmap.createBitmap(RENDER, RENDER, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        canvas.drawColor(Color.BLACK)
        d.setBounds(0, 0, RENDER, RENDER)
        d.draw(canvas)

        val px = IntArray(RENDER * RENDER)
        bmp.getPixels(px, 0, RENDER, 0, 0, RENDER, RENDER)
        bmp.recycle()

        val (x0, y0, x1, y1) = visibleBounds(ctx, d, px)
        val cropW = x1 - x0 + 1
        val cropH = y1 - y0 + 1

        // Square the crop around its own centre so a wide or tall icon keeps its aspect ratio
        // instead of being stretched to fill the grid.
        val side = max(cropW, cropH)
        val cx = x0 + cropW / 2
        val cy = y0 + cropH / 2
        val sx = cx - side / 2
        val sy = cy - side / 2

        // Box-average each grid cell over its patch of the supersampled render.
        val lum = DoubleArray(size * size)
        var maxLum = 0.0
        for (r in 0 until size) {
            for (c in 0 until size) {
                var sum = 0.0
                var n = 0
                val py0 = sy + (r * side) / size
                val py1 = sy + ((r + 1) * side) / size
                val px0 = sx + (c * side) / size
                val px1 = sx + ((c + 1) * side) / size
                for (y in py0 until max(py0 + 1, py1)) {
                    if (y < 0 || y >= RENDER) continue
                    for (x in px0 until max(px0 + 1, px1)) {
                        if (x < 0 || x >= RENDER) continue
                        val p = px[y * RENDER + x]
                        // Rec. 601 luma — closer to perceived brightness than a flat mean, and
                        // the icon is already composited over black so alpha is baked in.
                        sum += 0.299 * Color.red(p) + 0.587 * Color.green(p) + 0.114 * Color.blue(p)
                        n++
                    }
                }
                val v = if (n > 0) sum / n / 255.0 else 0.0
                lum[r * size + c] = v
                if (v > maxLum) maxLum = v
            }
        }

        if (maxLum < 0.02) return "[]"   // effectively blank — better to draw nothing
        val rows = JSONArray()
        for (r in 0 until size) {
            val sb = StringBuilder(size)
            for (c in 0 until size) {
                val v = lum[r * size + c] / maxLum
                sb.append(when {
                    v > 0.66 -> 'X'
                    v > 0.38 -> '*'
                    v > 0.14 -> '+'
                    else -> '.'
                })
            }
            rows.put(sb.toString())
        }
        return rows.toString()
    }

    private data class Bounds(val x0: Int, val y0: Int, val x1: Int, val y1: Int)

    /**
     * Tightest box holding actual icon content. Uses the drawable's own alpha where it has any
     * — that is the true silhouette — and falls back to "brighter than black" for opaque
     * adaptive icons, whose alpha is 1 everywhere and so says nothing about where the art is.
     */
    private fun visibleBounds(ctx: Context, d: Drawable, composited: IntArray): Bounds {
        val alphaBmp = Bitmap.createBitmap(RENDER, RENDER, Bitmap.Config.ARGB_8888)
        val c = Canvas(alphaBmp)
        d.setBounds(0, 0, RENDER, RENDER)
        d.draw(c)                                  // no black fill: keeps real transparency
        val ap = IntArray(RENDER * RENDER)
        alphaBmp.getPixels(ap, 0, RENDER, 0, 0, RENDER, RENDER)
        alphaBmp.recycle()

        var x0 = RENDER; var y0 = RENDER; var x1 = -1; var y1 = -1
        var sawTransparent = false
        for (y in 0 until RENDER) {
            for (x in 0 until RENDER) {
                if (Color.alpha(ap[y * RENDER + x]) < ALPHA_FLOOR) { sawTransparent = true; continue }
                if (x < x0) x0 = x; if (x > x1) x1 = x
                if (y < y0) y0 = y; if (y > y1) y1 = y
            }
        }
        if (!sawTransparent || x1 < x0 || y1 < y0) {
            // Fully opaque (or nothing found): fall back to non-black content.
            x0 = RENDER; y0 = RENDER; x1 = -1; y1 = -1
            for (y in 0 until RENDER) {
                for (x in 0 until RENDER) {
                    val p = composited[y * RENDER + x]
                    if (Color.red(p) + Color.green(p) + Color.blue(p) < 24) continue
                    if (x < x0) x0 = x; if (x > x1) x1 = x
                    if (y < y0) y0 = y; if (y > y1) y1 = y
                }
            }
        }
        if (x1 < x0 || y1 < y0) return Bounds(0, 0, RENDER - 1, RENDER - 1)
        return Bounds(x0, y0, x1, y1)
    }
}
