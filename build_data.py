import pandas as pd, json

xlsx_path = 'final.xlsx'  # put your latest Excel next to this script
out_path = 'data.json'

df = pd.read_excel(xlsx_path)
df = df.loc[:, ~df.columns.str.match(r'^Unnamed')]
df = df.fillna('')

for col in df.columns:
    df[col] = df[col].astype(str)

records = df.to_dict(orient='records')
pillars = sorted({r.get('Pillar','').strip() for r in records if r.get('Pillar','').strip()})

with open(out_path, 'w', encoding='utf-8') as f:
    json.dump({'pillars': pillars, 'papers': records}, f, ensure_ascii=False)

print(f'Wrote {out_path} with {len(records)} papers and {len(pillars)} pillars.')
