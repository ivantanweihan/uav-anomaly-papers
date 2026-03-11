import pandas as pd, json

xlsx_path = 'final.xlsx'  # keep next to this script
out_path = 'data.json'

pillars = ["Generation","Prevention","Detection","Recovery/Mitigation","Analysis/Learning"]

xl = pd.ExcelFile(xlsx_path)
sheet = "Papers" if "Papers" in xl.sheet_names else xl.sheet_names[0]

df = pd.read_excel(xlsx_path, sheet_name=sheet)
df = df.loc[:, ~df.columns.str.match(r'^Unnamed')]
df = df.fillna('')

for col in df.columns:
    df[col] = df[col].astype(str)

# Ensure PillarAny exists for multi-label lifecycle filtering
prim = df.get('Pillar', pd.Series(['']*len(df))).astype(str).str.strip()
allcol = df.get('Pillar_All', pd.Series(['']*len(df))).astype(str).str.strip()
sec = df.get('Pillar_Secondary', pd.Series(['']*len(df))).astype(str).str.strip()

pillar_any = allcol.where(allcol != '', prim)
pillar_any = pillar_any.where(sec == '', (prim + ', ' + sec).str.strip(', ')).where(allcol == '', pillar_any)
df['PillarAny'] = pillar_any

records = df.to_dict(orient='records')

data = {
  "pillars": pillars,
  "papers": records,
  "facets": [
    {"key":"PillarAny","label":"Lifecycle (primary + secondary)"},
    {"key":"Pillar","label":"Pillar (primary)"},
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

print(f'Wrote {out_path} with {len(records)} papers from sheet: {sheet}.')