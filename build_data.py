import pandas as pd, json

xlsx_path = 'check.xlsx'  # keep next to this script
out_path = 'data.json'

pillars = ["Generation","Prevention","Detection","Recovery/Mitigation","Analysis/Learning"]

df = pd.read_excel(xlsx_path, sheet_name="Papers")
df = df.loc[:, ~df.columns.str.match(r'^Unnamed')]
df = df.fillna('')

for col in df.columns:
    df[col] = df[col].astype(str)

records = df.to_dict(orient='records')

data = {
  "pillars": pillars,
  "papers": records,
  "facets": [
    {"key":"Pillar","label":"Pillar"},
    {"key":"Technique","label":"Technique"},
    {"key":"DataSource","label":"Data source"},
    {"key":"ApplicationContext","label":"Application context"},
    {"key":"DatasetAvailable","label":"Dataset available"},
    {"key":"SourceOfAnomaly","label":"Source of anomaly"},
    {"key":"NatureOfAnomaly","label":"Nature of anomaly"},
    {"key":"DetectionApproach","label":"Detection approach"},
  ]
}

with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False)

print(f'Wrote {out_path} with {len(records)} papers.')
