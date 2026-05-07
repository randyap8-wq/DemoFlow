/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { serializedNodeWithId } from 'rrweb-snapshot';

export interface Keyframe {
  timestamp: number;
  x: number; // Percentage or absolute px
  y: number;
  easing?: string;
  type: 'move' | 'click' | 'wait';
}

export interface Hotspot {
  id: string;
  selector: string; // CSS selector to match inside the snapshot
  label?: string;
  nextStepId: string;
}

export interface Mutation {
  selector: string;
  action: 'text' | 'style' | 'hide';
  value: string;
}

export interface DemoStep {
  id: string;
  /**
   * Either an rrweb-snapshot serialized DOM tree (rebuilt into the iframe)
   * or a raw HTML string (injected via iframe `srcdoc`). At least one must
   * be provided.
   */
  snapshot?: serializedNodeWithId;
  html?: string;
  keyframes: Keyframe[];
  hotspots: Hotspot[];
  mutations?: Mutation[];
  autoTransition?: boolean;
}

export interface DemoScript {
  title: string;
  description?: string;
  steps: DemoStep[];
  theme?: {
    primaryColor: string;
    cursorType: 'default' | 'circle' | 'dot';
  };
}
