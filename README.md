# Expense-Tracker
This is simple Java CLI Based Expense tracker

# Phase 1: Core Console Application (Foundations)

**🎯 Goal:** Build a simple expense tracker that runs in the terminal.

### Features
- Add Expense (amount, category, date, description)
- View All Expenses (display all stored expenses)
- Calculate Total Expense
- Filter by Category or Date
- Exit and Save Data to File (CSV or text)

### Concepts to Learn
- Java Classes (`Expense`, `ExpenseManager`)
- Lists (`ArrayList`)
- File handling (`FileWriter`, `BufferedReader`)
- Menu-driven input using `Scanner`

## 🧱 Phase 2: File & Data Management (Persistence Layer)

**🎯 Goal:** Save and load data automatically from files.

### Features
- Auto Save and Load from CSV or JSON
- Data Validation (amount, date format, etc.)
- Search Feature (by keyword or date range)

### Concepts to Learn
- Exception Handling
- Serialization or JSON parsing (`Gson` / `Jackson`)
- Helper classes for file I/O

---

## 🧮 Phase 3: Reporting and Analytics

**🎯 Goal:** Add analytical insights for the user.

### Features
- Monthly Summary (total per month)
- Category Breakdown (total per category)
- Highest & Lowest Expense Report

### Concepts to Learn
- Collections & Maps (`Map<Category, Double>`)
- Date handling (`LocalDate`, `DateTimeFormatter`)
- Sorting and Streams API
