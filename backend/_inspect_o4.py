# -*- coding: utf-8 -*-
import json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
path = r"C:\Users\Admin\Desktop\KẾ HOẠCH MỤC TIÊU\KHMT Hàng tháng\_compare.json"
with open(path, encoding="utf-8") as f:
    data = json.load(f)
o = data["02"]["O4"]
print(json.dumps(o, ensure_ascii=False, indent=2))
