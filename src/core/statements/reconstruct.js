/**
 * Reconstructs lines of text from individual PDF text items.
 *
 * Items shape: [{ str: string, x: number, y: number, width: number, height: number, page: number }]
 *
 * Algorithm:
 * 1. Groups items by page.
 * 2. On each page, computes median item height (defaults to 10 if none).
 * 3. Clusters items with nearly equal y (tolerance = 0.5 * median height) into lines.
 * 4. Sorts lines by y descending (in PDF coordinate space, larger y is higher on the page).
 * 5. Within each line, sorts items by x ascending (left to right).
 * 6. Joins items with a single space when the gap <= 1.5 * medianCharWidth,
 *    or with a tab marker (" ⇥ ") when gap > 1.5 * medianCharWidth (keeps table columns visible).
 * 7. Drops empty lines.
 * 8. Returns [{ page: number, lineNo: number, text: string }].
 */

function computeMedian(numbers, fallback = 10) {
  const valid = numbers.filter((n) => typeof n === 'number' && !isNaN(n) && n > 0);
  if (valid.length === 0) return fallback;
  const sorted = [...valid].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function reconstructLines(items = []) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  // 1. Group items by page
  const pageMap = new Map();
  for (const item of items) {
    if (!item || typeof item.str !== 'string') continue;
    const pageNum = Number(item.page) || 1;
    if (!pageMap.has(pageNum)) {
      pageMap.set(pageNum, []);
    }
    pageMap.get(pageNum).push(item);
  }

  // Sort pages ascending (page 1, page 2...)
  const sortedPageNumbers = Array.from(pageMap.keys()).sort((a, b) => a - b);
  const resultLines = [];

  for (const pageNum of sortedPageNumbers) {
    const pageItems = pageMap.get(pageNum);
    if (pageItems.length === 0) continue;

    // 2. Compute median item height and median char width for this page
    const heights = pageItems.map((it) => it.height).filter((h) => h > 0);
    const medianHeight = computeMedian(heights, 10);
    const yTolerance = 0.5 * medianHeight;

    const charWidths = [];
    for (const it of pageItems) {
      const len = it.str.trim().length;
      if (len > 0 && it.width > 0) {
        charWidths.push(it.width / len);
      }
    }
    const medianCharWidth = computeMedian(charWidths, 5);
    const wideGapThreshold = 1.5 * medianCharWidth;

    // 3. Cluster items by nearly equal y (tolerance = 0.5 * medianHeight)
    // Sort items by y descending first (larger y is higher up on page)
    const sortedItems = [...pageItems].sort((a, b) => b.y - a.y);

    const lineClusters = []; // [{ avgY, sumY, items: [] }]
    for (const item of sortedItems) {
      let matchedCluster = null;
      let minDistance = Infinity;

      for (const cluster of lineClusters) {
        const dist = Math.abs(item.y - cluster.avgY);
        if (dist <= yTolerance && dist < minDistance) {
          minDistance = dist;
          matchedCluster = cluster;
        }
      }

      if (matchedCluster) {
        matchedCluster.items.push(item);
        matchedCluster.sumY += item.y;
        matchedCluster.avgY = matchedCluster.sumY / matchedCluster.items.length;
      } else {
        lineClusters.push({
          avgY: item.y,
          sumY: item.y,
          items: [item],
        });
      }
    }

    // 4. Sort line clusters from top to bottom (avgY descending)
    lineClusters.sort((a, b) => b.avgY - a.avgY);

    // 5. Within each line, sort items by x ascending and join
    let pageLineCounter = 0;
    for (const cluster of lineClusters) {
      cluster.items.sort((a, b) => a.x - b.x);

      let lineText = '';
      let prevItem = null;

      for (const item of cluster.items) {
        const str = item.str;
        if (!str && str !== '') continue;

        if (prevItem === null) {
          lineText = str;
        } else {
          const prevRight = prevItem.x + (prevItem.width || 0);
          const gap = item.x - prevRight;

          if (gap > wideGapThreshold) {
            lineText += ' ⇥ ' + str;
          } else {
            lineText += ' ' + str;
          }
        }
        prevItem = item;
      }

      const trimmedText = lineText.trim();
      if (trimmedText.length > 0) {
        pageLineCounter += 1;
        resultLines.push({
          page: pageNum,
          lineNo: pageLineCounter,
          text: trimmedText,
        });
      }
    }
  }

  return resultLines;
}

