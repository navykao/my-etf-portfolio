// ==========================================
// แก้ไขฟังก์ชันค้นหาใน src/App.jsx
// ==========================================

// ======================================
// 1. ตรวจสอบว่ามีโค้ดโหลดข้อมูลหรือไม่
// ======================================

// ✅ ต้องมีโค้ดนี้ (ประมาณบรรทัด 20-40):

const [assets, setAssets] = useState([]);

useEffect(() => {
  fetch('/data/combined-all-assets.json')
    .then(res => res.json())
    .then(data => {
      console.log('✅ โหลดข้อมูลสำเร็จ:', data.length, 'หุ้น');
      setAssets(data);
    })
    .catch(err => {
      console.error('❌ Error loading data:', err);
    });
}, []);

// ======================================
// 2. ฟังก์ชันค้นหา
// ======================================

// ✅ แก้ไขฟังก์ชันค้นหา (ประมาณบรรทัด 100-150):

const handleSearch = (e) => {
  e.preventDefault();
  
  const searchInput = e.target.querySelector('input[name="search"]');
  const searchTerm = searchInput.value.trim().toUpperCase();
  
  console.log('🔍 ค้นหา:', searchTerm);
  console.log('📊 จำนวนข้อมูล:', assets.length);
  
  if (!searchTerm) {
    alert('กรุณาใส่ Symbol หุ้น');
    return;
  }
  
  // ค้นหาในข้อมูลที่โหลดแล้ว
  const found = assets.find(stock => 
    stock.symbol === searchTerm || 
    stock.symbol.toUpperCase() === searchTerm
  );
  
  console.log('📍 ผลลัพธ์:', found);
  
  if (found) {
    // เพิ่มใน watchlist
    const currentWatchlist = JSON.parse(localStorage.getItem('watchlist') || '[]');
    
    // เช็คว่ามีอยู่แล้วหรือไม่
    const exists = currentWatchlist.some(item => item.symbol === found.symbol);
    
    if (!exists) {
      currentWatchlist.push(found);
      localStorage.setItem('watchlist', JSON.stringify(currentWatchlist));
      alert(`✅ เพิ่ม ${found.symbol} ใน Watchlist แล้ว`);
      
      // Refresh watchlist
      setWatchlist(currentWatchlist);
    } else {
      alert(`⚠️ ${found.symbol} มีใน Watchlist อยู่แล้ว`);
    }
    
    // Clear input
    searchInput.value = '';
  } else {
    alert(`❌ ไม่พบหุ้น ${searchTerm} ในฐานข้อมูล`);
  }
};

// ======================================
// 3. ตรวจสอบ HTML Form
// ======================================

// ✅ Form ต้องเป็นแบบนี้:

<form onSubmit={handleSearch} className="search-form">
  <input 
    type="text" 
    name="search"
    placeholder="ค้นหา Symbol (เช่น SCHG, VTI)" 
    className="search-input"
  />
  <button type="submit" className="search-button">
    🔍 ค้นหา
  </button>
</form>

// ======================================
// 4. หาโค้ดที่ผิด (ต้องลบออก)
// ======================================

// ❌ ลบโค้ดเหล่านี้ถ้ามี:

// ผิด 1: เรียก API ที่ไม่มี
fetch('/api/search?symbol=' + symbol)

// ผิด 2: เรียกไฟล์ที่ไม่มี
fetch('/data/stocks/' + symbol + '.json')

// ผิด 3: เรียก API อื่น
fetch('https://api.example.com/search?q=' + symbol)

// ======================================
// 5. Debug: ตรวจสอบในหน้าเว็บ
// ======================================

// กด F12 → Console → พิมพ์:

console.log('📊 จำนวนหุ้น:', assets.length);
console.log('🔍 ค้นหา SCHG:', assets.find(s => s.symbol === 'SCHG'));

// ควรเห็น:
// 📊 จำนวนหุ้น: 746
// 🔍 ค้นหา SCHG: {symbol: "SCHG", name: "Schwab U.S. Large-Cap Growth ET", ...}

// ======================================
// 6. Path ไฟล์
// ======================================

// ✅ โครงสร้างโฟลเดอร์ที่ถูกต้อง:

public/
  data/
    combined-all-assets.json  ← ไฟล์ข้อมูล
  index.html
src/
  App.jsx  ← แก้ไขไฟล์นี้

// ======================================
// สรุป: สิ่งที่ต้องแก้
// ======================================

/*
1. ✅ โหลดข้อมูลจาก: /data/combined-all-assets.json
2. ✅ ค้นหาใน: assets array (ที่โหลดแล้ว)
3. ❌ ห้ามเรียก: /api/search หรือ URL อื่น
4. ✅ แปลงเป็นตัวใหญ่: .toUpperCase()
5. ✅ เก็บใน localStorage: watchlist
*/
