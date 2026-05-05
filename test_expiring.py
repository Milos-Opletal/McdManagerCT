import os, json
from dotenv import load_dotenv
from MyMcdAPI import MyMcdAPI

load_dotenv()
api = MyMcdAPI(os.getenv("MYMCD_EMAIL"), os.getenv("MYMCD_PASSWORD"))
api.login()

codes = api.get_default_codes()
print("Keys:", codes.keys())
with open('test_verifications.json', 'w', encoding='utf-8') as f:
    json.dump(codes['verifications'][:5], f, ensure_ascii=False, indent=2)
