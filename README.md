# 🪙 Koinfo ℹ️

**Koinfo** is an interactive personal finance dashboard built with Python and Flask.  
It helps you track incomes, expenses, savings, debts, and goals, manage budgets, and visualize spending patterns over time.  
With a clean UI and dynamic charts, the app makes it easy to stay on top of your finances and plan for the future.

---

## ✨ Features

- 📊 **Dashboard overview** – Track income, expenses, savings, debts, and net position instantly.  
- 🔄 **Flexible timelines** – View spending by category across the current cycle or last 3, 6, or 12 months.  
- 📝 **Manage Data** – Add, edit, or delete categories, transactions, debts, and savings goals.  
- ⚙️ **Customization** – Set your budget reset day and opening balance; data stored locally in `data/finance_data.json`.  
- 📑 **Insights & reset** – Download a **PDF summary** or reset the app to defaults anytime.  
- 📱 **Responsive design** – Clean, mobile-friendly UI powered by HTML/CSS/JS.  


---

## 📦 Direct Download (Standalone)

Don’t want to install Python or dependencies? Grab the **standalone `.exe`** and run it directly on your system:

👉 [**Download Latest Release**](https://github.com/Goutham-Sidhik/Koinfo/releases/latest)

> The app starts automatically when you run the `.exe`.

---

## 🛠️ Installation (From Source Code)

1. Ensure you have **Python 3.10+** and **pip** installed.  
2. Clone this repository:
   ```bash
   git clone https://github.com/Goutham-Sidhik/Koinfo.git
   cd Koinfo
   ```
3. (Optional) Create and activate a virtual environment:
   ```bash
   python -m venv venv
   venv\Scripts\activate
   ```

4. Install dependencies  
   ```bash
   pip install -r requirements.txt
   ```
---

## 🚀 Usage

   Start the Flask server:
   ```bash
   python app.py
   ```
By default, the app runs on http://127.0.0.1:2901 and automatically opens a browser window.
   - Visit **dashboard** for an overview of your finances.
   - Manage categories, transactions, debts, and goals at **manage**.

---

## ⚙️ Configuration

🔌 Port: Set a different port in needed at app.run() in app.py.

📂 Data file: Your data is stored in data/finance_data.json. Delete this file or use the Reset data action to start fresh.

📅 Budget cycle: Configure the day your budget cycle resets via the UI; this value is stored in localStorage on the client.

💱 Currency formatting: The frontend uses your browser’s locale for number formatting and falls back to INR.
Adjust the fmtINR / formatINR functions in static/js/manage.js and static/js/dashboard.js to change the default symbol.

---

## 🛠️ Tech Stack

- **Backend:** Python, Flask
- **Data:** JSON (local storage)
- **Frontend:** HTML, CSS, JavaScript (built into templates)

---

## 📷 Screenshots

*(Add screenshots of dashboard here)*

---

## 📌 Planned Features

- 🔐 **User authentication** – Secure logins to protect personal finance data.  
- 👥 **Multi-user support** – Separate dashboards so multiple people can use the same app independently.  
- 💱 **Currency selection** – Choose your preferred currency beyond the default locale/INR.  
- 📱 **Mobile version** – Optimized standalone app experience for Android/iOS.  
- ☁️ **Cloud sync** – Seamlessly access your data across devices.  
- 📊 **Advanced analytics** – AI-driven insights, expense forecasting, and personalized recommendations.  

---

## 📜 License

This project is released under the MIT License. See the LICENSE file for details.

---

## 🤝 Contributing

Contributions are welcome! Fork the repository, create a branch for your feature or bug fix, and open a pull request.
Please open an issue first to discuss major changes.

---

### ✨ Author

Goutham Sidhik ☺️
