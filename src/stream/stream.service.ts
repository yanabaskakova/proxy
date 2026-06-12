import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface Block {
  text: string;
  isCode: boolean;
}

/**
 * Splits a response string into chunks suitable for incremental streaming.
 *
 * Strategy:
 *   1. Prefer splitting by paragraphs (blank-line separated blocks), keeping
 *      fenced code blocks (``` ... ```) intact so markdown/code formatting is
 *      preserved.
 *   2. Any non-code block larger than the configured chunk size is further
 *      split by size on word boundaries. Fenced code blocks are always emitted
 *      whole, regardless of size.
 *
 * Concatenating every returned chunk reproduces the original string exactly.
 */
@Injectable()
export class StreamService {
  constructor(private readonly config: ConfigService) {}

  private get defaultChunkSize(): number {
    return this.config.get<number>('app.streamChunkSize', 100);
  }

  chunk(text: string, chunkSize?: number): string[] {
    if (text === '') {
      return [];
    }
    const size =
      chunkSize !== undefined && chunkSize > 0 ? chunkSize : this.defaultChunkSize;

    const chunks: string[] = [];
    for (const block of this.toBlocks(text)) {
      if (block.isCode || block.text.length <= size) {
        chunks.push(block.text);
      } else {
        chunks.push(...this.splitBySize(block.text, size));
      }
    }

    return chunks.filter((c) => c.length > 0);
  }

  /**
   * Break the text into ordered blocks: fenced code blocks are kept whole,
   * everything else is segmented into paragraphs on blank-line boundaries.
   */
  private toBlocks(text: string): Block[] {
    const regions = this.toRegions(text);
    const blocks: Block[] = [];

    regions.forEach((region, index) => {
      // The newline that originally separated this region from the next one
      // was consumed when splitting on '\n'; reattach it for faithful joins.
      const suffix = index < regions.length - 1 ? '\n' : '';
      const regionText = region.lines.join('\n') + suffix;

      if (region.isCode) {
        blocks.push({ text: regionText, isCode: true });
        return;
      }

      // Split a non-code region into paragraphs, keeping the blank-line
      // separators attached to the preceding paragraph.
      const parts = regionText.split(/(\n[ \t]*\n)/);
      let buffer = '';
      for (const part of parts) {
        buffer += part;
        if (/^\n[ \t]*\n$/.test(part)) {
          blocks.push({ text: buffer, isCode: false });
          buffer = '';
        }
      }
      if (buffer.length > 0) {
        blocks.push({ text: buffer, isCode: false });
      }
    });

    return blocks.filter((b) => b.text.length > 0);
  }

  /** Segment the raw text into alternating code / non-code line regions. */
  private toRegions(text: string): Array<{ isCode: boolean; lines: string[] }> {
    const lines = text.split('\n');
    const regions: Array<{ isCode: boolean; lines: string[] }> = [];
    let current: { isCode: boolean; lines: string[] } = {
      isCode: false,
      lines: [],
    };
    let inCode = false;

    for (const line of lines) {
      const isFence = line.trimStart().startsWith('```');

      if (isFence && !inCode) {
        if (current.lines.length > 0) {
          regions.push(current);
        }
        current = { isCode: true, lines: [line] };
        inCode = true;
      } else if (isFence && inCode) {
        current.lines.push(line);
        regions.push(current);
        current = { isCode: false, lines: [] };
        inCode = false;
      } else {
        current.lines.push(line);
      }
    }

    if (current.lines.length > 0) {
      regions.push(current);
    }
    return regions;
  }

  /** Hard-split a long, non-code block into <= size pieces on word boundaries. */
  private splitBySize(text: string, size: number): string[] {
    const out: string[] = [];
    let remaining = text;

    while (remaining.length > size) {
      let cut = size;
      const window = remaining.slice(0, size);
      const lastSpace = window.lastIndexOf(' ');
      // Only break on whitespace if it doesn't leave a tiny first piece.
      if (lastSpace > size * 0.5) {
        cut = lastSpace + 1;
      }
      out.push(remaining.slice(0, cut));
      remaining = remaining.slice(cut);
    }

    if (remaining.length > 0) {
      out.push(remaining);
    }
    return out;
  }
}
