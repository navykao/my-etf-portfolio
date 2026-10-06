# 📊 ETF Portfolio Tracker v6.3

Enhanced Dividend Information Display - แสดงข้อมูลปันผลในการ์ดหุ้นแต่ละตัว

## 🎯 Features

### ✨ ฟีเจอร์ใหม่ที่เพิ่มเข้ามา:

#### 📱 **หน้า Search (Mobile)**
- แสดงการ์ดปันผลสีเขียว แยกเป็นส่วนพิเศษ
- **Dividend Yield** (% ผลตอบแทนปันผล)
- **ปันผล/หุ้น/ปี** (Trailing Dividend Rate)
- **การเติบโตของปันผล** (Dividend Growth):
  - 3Y (3 ปี)
  - 5Y (5 ปี) 
  - 10Y (10 ปี)
- มีไอคอน 📈 แสดงการเติบโต

#### 💻 **หน้า Search (Desktop)**
- แสดงเป็นตาราง มีคอลัมน์:
  - Div Yield
  - ปันผล/หุ้น (Trailing Dividend Rate)
  - Div Growth (แสดง 3Y, 5Y, 10Y แยกสี)

#### ⭐ **หน้า Watchlist**
- แสดงข้อมูลปันผลเพิ่มเติม:
  - Dividend Yield และ Dividend per Share
  - การเติบโตปันผล 3Y, 5Y, 10Y

#### 💰 **หน้า Dividends**
- แสดงข้อมูลครบถ้วน:
  - ปันผลต่องวด และต่อปี
  - Dividend Yield
  - การเติบโตของปันผล (มีไอคอน TrendingUp)
  - Trailing Dividend Rate

## 📂 โครงสร้างไฟล์

```
my-etf-portfolio/
├── src/
│   ├── App.jsx          ← ไฟล์หลักของแอป
│   └── main.jsx         ← Entry point
├── public/
│   └── data/
│       └── combined-746-assets.json  ← ข้อมูลหุ้น 746 ตัว
├── package.json
└── vite.config.js
```

## 🚀 วิธีใช้งาน

### 1. Deploy บน Vercel

1. Push โค้ดขึ้น GitHub
2. ไปที่ [vercel.com](https://vercel.com)
3. Import project จาก GitHub
4. Vercel จะ auto-detect Vite และ deploy ให้อัตโนมัติ

#### 🔐 ตั้งค่า Environment Variables บน Vercel

API key และ GitHub token ต้องอยู่ฝั่ง server เท่านั้น (ตัวแปรขึ้นต้น `VITE_` จะถูกฝังใน JS ที่ส่งให้ทุกคน) โค้ดใน `api/` เป็น Vercel Serverless Functions:

| Endpoint | หน้าที่ | ตัวแปรที่ใช้ |
|---|---|---|
| `GET /api/quote?symbol=` | ราคา Live Mode (ต้องล็อกอิน) | `FINNHUB_API_KEY`, `FMP0N8_API_KEY`, `TWELVE_DATA_API_KEY`, `EODHD_API_KEY` |
| `GET /api/status` | แสดงว่า provider ไหนตั้งค่าแล้ว | (เหมือนข้างบน) |
| `POST /api/sync-flags` | เขียน `inPortfolio`/`inWatchlist` กลับ JSON (เฉพาะเจ้าของ) | `GITHUB_SYNC_TOKEN`, `ALLOWED_EMAILS` |

ตัวแปรทั้งหมดและวิธีสร้าง token ดูใน `.env.example` ส่วน `VITE_FIREBASE_*` ยังเป็นค่า public ตามปกติ

### 2. ใช้ข้อมูลจากไฟล์ (ฟรี ไม่เสียค่า API)

แอปจะโหลดข้อมูลจาก `/public/data/combined-746-assets.json` โดยอัตโนมัติ

ไม่ต้องเรียก API เลย = **ไม่เสียเงิน!** 🎉

### 3. อัปเดทข้อมูลหุ้น (ถ้าต้องการ)

ใช้สคริปต์ Python ที่มีให้:

```bash
# ติดตั้ง yfinance
pip install yfinance

# รันสคริปต์
python scripts/update-stock-data.py
```

สคริปต์จะ:
- ดึงข้อมูล 746 symbols จาก yfinance (ฟรี!)
- บันทึกลง `/public/data/combined-746-assets.json`
- ไม่กิน quota ของ FMP/FinnHub เลย!

## 📊 ข้อมูลที่รองรับ

ไฟล์ JSON มีข้อมูล:
- `symbol` - สัญลักษณ์หุ้น
- `name` - ชื่อบริษัท
- `price` - ราคา
- `divYield` / `dividendYield` - % ผลตอบแทนปันผล
- `trailingDividendRate` - จำนวนเงินปันผลต่อหุ้นต่อปี
- `divGrowth3Y` - การเติบโตปันผล 3 ปี
- `divGrowth5Y` - การเติบโตปันผล 5 ปี
- `divGrowth10Y` - การเติบโตปันผล 10 ปี
- `type` - ประเภท (Stock/ETF)

## 🎨 การออกแบบ

- ใช้สีเขียว-เอมเมอรัลด์สำหรับข้อมูลปันผล
- แสดงเป็นกราเดียนต์การ์ด บน Mobile
- จัดเรียงข้อมูลให้อ่านง่าย
- รองรับทั้ง Desktop และ Mobile

## 🔧 Tech Stack

- **React** - UI Framework
- **Vite** - Build Tool
- **Recharts** - Charts Library
- **Lucide React** - Icons
- **Tailwind CSS** - Styling
- **Firebase** - Authentication & Database
- **yfinance** - Free Stock Data (Python)

## 📝 หมายเหตุ

- ข้อมูลในไฟล์ JSON เป็นข้อมูล Static (ไม่ Real-time)
- แนะนำให้รันสคริปต์ update-stock-data.py ทุกวันเพื่ออัปเดทข้อมูล
- หรือตั้ง GitHub Actions ให้รันอัตโนมัติทุกวัน
- **ฟรี 100%** ไม่ต้องใช้ API Key ใดๆ!

## 🎉 ข้อดี

✅ **ไม่เสียค่าใช้จ่าย** - ใช้ข้อมูลจากไฟล์ JSON
✅ **รวดเร็ว** - ไม่ต้องรอ API response
✅ **เสถียร** - ไม่มีปัญหา rate limit
✅ **แสดงข้อมูลปันผลครบถ้วน** - ทั้ง Yield, Rate และ Growth
✅ **สวยงาม** - UI/UX ออกแบบมาดี

---

Made with ❤️ by navykao
Version 6.3 - Enhanced Dividend Display
