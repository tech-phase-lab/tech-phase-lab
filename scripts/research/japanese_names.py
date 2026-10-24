"""One Japanese spelling per watched company (owner, Oct 16: GE Vernova appeared as GEヴァーノバ, GEベルノバ ...).

The headline translators read this list so the same company is always written the same way.
The spellings match the site's own stock search (lib/research/stock-search.ts).
"""
NAMES = {
    'GE Vernova': 'GEベルノバ', 'Micron': 'マイクロン', 'SK hynix': 'SKハイニックス', 'SanDisk': 'サンディスク',
    'Nebius': 'ネビウス', 'Nvidia': 'エヌビディア', 'Broadcom': 'ブロードコム', 'Arm Holdings': 'アーム',
    'TSMC': 'TSMC', 'Marvell': 'マーベル', 'Arista Networks': 'アリスタ', 'Credo': 'クレド', 'CoreWeave': 'コアウィーブ',
    'Vertiv': 'バーティブ', 'Dell': 'デル', 'Palantir': 'パランティア', 'Microsoft': 'マイクロソフト',
    'Bloom Energy': 'ブルーム・エナジー', 'Alphabet': 'アルファベット', 'Oracle': 'オラクル', 'Lumentum': 'ルメンタム',
    'Astera Labs': 'アステラ・ラボ', 'Applied Optoelectronics': 'アプライド・オプトエレクトロニクス',
    'Applied Materials': 'アプライド・マテリアルズ',
}


def policy_line():
    pairs = ', '.join(f'{english} = {japanese}' for english, japanese in NAMES.items())
    return ('Always write these companies in Japanese exactly as follows (one spelling each): ' + pairs + '.')
