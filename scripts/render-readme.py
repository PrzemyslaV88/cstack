"""Render the GitHub hero and benchmark chart from the published result summary.

Optional documentation tooling: python -m pip install 'matplotlib>=3.10,<4'
The cStack runtime has no dependency on Matplotlib. No model calls are made.
"""
import argparse
import json
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, Polygon
from matplotlib.ticker import FuncFormatter, MultipleLocator

ROOT = Path(__file__).resolve().parents[1]
BG, PANEL, INK, MUTED, MINT, BLUE = '#0b1220', '#142138', '#f3f7ff', '#a5b6cf', '#52edc5', '#6c8fff'
plt.rcParams.update({'font.family': 'DejaVu Sans', 'svg.fonttype': 'none', 'svg.hashsalt': 'cstack-readme-0.3',
                     'figure.facecolor': BG, 'axes.facecolor': BG, 'text.color': INK})


def save(fig, name, output, preview):
    output.mkdir(parents=True, exist_ok=True)
    svg = output / (name + '.svg')
    fig.savefig(svg, facecolor=BG, metadata={'Date': None, 'Creator': 'cStack', 'Title': name})
    text = svg.read_text().replace("font-family: 'DejaVu Sans';", "font-family: 'DejaVu Sans', Arial, Helvetica, sans-serif;")
    svg.write_text('\n'.join(line.rstrip() for line in text.splitlines()) + '\n')
    if preview:
        preview.mkdir(parents=True, exist_ok=True)
        fig.savefig(preview / (name + '.png'), dpi=160, facecolor=BG)
    plt.close(fig)


def hero(output, preview):
    fig = plt.figure(figsize=(12, 3.65)); ax = fig.add_axes([0, 0, 1, 1]); ax.set(xlim=(0, 12), ylim=(0, 3.65)); ax.axis('off')
    ax.add_patch(FancyBboxPatch((0.02, .02), 11.96, 3.61, boxstyle='round,pad=0,rounding_size=.17', facecolor=BG, edgecolor='#253753', linewidth=1))
    ax.text(.6, 3.12, 'LOCAL CODEX PLUGIN', color=MINT, fontsize=10, weight='bold', va='center')
    ax.text(3.0, 3.12, 'v0.3.0', color=MUTED, fontsize=10, va='center')
    ax.text(.56, 2.25, 'cStack', fontsize=56, weight='bold', va='center', color=INK)
    ax.text(.6, 1.56, 'Understand your code. Verify the fix.', fontsize=22, weight='normal', va='center')
    ax.text(.6, 1.09, 'Project intelligence and checked repairs, inside Codex.', fontsize=11.5, color=MUTED, va='center')
    for x, width, name in [(.6, 1.65, 'CODE MAPS'), (2.4, 1.95, 'STACK ANALYSIS'), (4.5, 2.1, 'CHECKED REPAIRS')]:
        ax.add_patch(FancyBboxPatch((x, .38), width, .36, boxstyle='round,pad=.05,rounding_size=.08', facecolor=PANEL, edgecolor='#2d4362', linewidth=.8))
        ax.text(x + width / 2, .56, name, fontsize=8, color=INK, ha='center', va='center', weight='bold')
    for y, fill, edge in [(1.14, '#162b40', '#385f76'), (1.64, '#1b3a50', BLUE), (2.14, '#173e43', MINT)]:
        ax.add_patch(Polygon([(9.28, y), (10.44, y + .5), (11.55, y), (10.4, y - .5)], closed=True,
                             facecolor=fill, edgecolor=edge, linewidth=1.8))
    ax.plot([10.4, 10.4], [.65, 1.1], color=MINT, alpha=.6, linewidth=1.2)
    ax.scatter([10.4], [.6], s=24, color=MINT)
    save(fig, 'cstack-hero', output, preview)


def benchmark(output, preview):
    data = json.loads((ROOT / 'docs/benchmarks/2026-11-01-results.json').read_text())
    records = {r['arm']: r for r in data['aggregates']}
    arms = [('current/cstack-harbor', 'cStack · single'), ('plain-codex', 'Plain Codex · single'),
            ('pstack-adapted-single-worker', 'pstack · single'), ('plain-codex-multiagent', 'Plain Codex · multi'),
            ('current/cstack-codex-multiagent', 'cStack · multi'), ('pstack-codex-multiagent', 'pstack · multi')]
    assert all(records[key]['trials'] == records[key]['private_passes'] == 5 and records[key]['accounting_complete'] for key, _ in arms)
    values = [records[key]['total_tokens'] for key, _ in arms]
    fig = plt.figure(figsize=(12, 5.8)); ax = fig.add_axes([.255, .23, .66, .57])
    fig.text(.055, .91, 'Five bugs. The recorded token footprint.', fontsize=21, weight='bold')
    fig.text(.055, .855, '5/5 independent bug-test passes for every workflow shown · all parent/helper tokens included', fontsize=10, color=MUTED)
    bars = ax.barh(range(len(arms)), values, height=.52, color=[MINT if key.startswith('current/') else '#6a83a7' for key, _ in arms], zorder=3)
    ax.set_yticks(range(len(arms)), [label for _, label in arms], color=INK, fontsize=11)
    ax.invert_yaxis(); ax.set_xlim(0, 8_400_000)
    ax.xaxis.set_major_locator(MultipleLocator(2_000_000))
    ax.xaxis.set_major_formatter(FuncFormatter(lambda value, _: f'{value / 1_000_000:g}M'))
    ax.tick_params(axis='both', length=0, colors=MUTED, pad=10)
    ax.grid(axis='x', color='#26344b', linewidth=.7, zorder=0)
    for spine in ax.spines.values(): spine.set_visible(False)
    for bar, value in zip(bars, values):
        ax.text(value + 100_000, bar.get_y() + bar.get_height() / 2, f'{value / 1_000_000:.2f}M', va='center', color=INK, fontsize=11, weight='bold')
    fig.text(.255, .14, 'Total native tokens (input + output; cached input counted once)', fontsize=10, color=MUTED)
    fig.text(.055, .075, 'Saved baselines + later cStack follow-up. Controller revisions differ; one trial per workflow per case.', fontsize=8.5, color=MUTED)
    fig.text(.055, .035, 'Descriptive results, not a general ranking or billing estimate. Benchmarks predate the 0.3 analysis additions.', fontsize=8.5, color=MUTED)
    save(fig, 'benchmark-tokens', output, preview)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'docs/assets')
    parser.add_argument('--preview-dir', type=Path)
    args = parser.parse_args()
    hero(args.output, args.preview_dir); benchmark(args.output, args.preview_dir)
    print('Rendered cstack-hero.svg and benchmark-tokens.svg from published benchmark data.')


if __name__ == '__main__':
    main()
