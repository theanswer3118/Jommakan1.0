#!/usr/bin/env python3
"""
Phase 2 (Purchasing) Backend Test Suite for Jom Makan Restaurant OS
Tests all 17 required scenarios as specified in test_result.md
"""

import requests
import json
import time
import sys
from typing import Dict, Any, Optional

# Base URL from .env
BASE_URL = "https://f42cc20a-05fc-4cc2-9953-96abb1429497.preview.emergentagent.com/api"

# Test results tracking
test_results = []

def log_test(test_name: str, passed: bool, message: str = ""):
    """Log test result"""
    status = "✅ PASS" if passed else "❌ FAIL"
    result = f"{status}: {test_name}"
    if message:
        result += f" - {message}"
    print(result)
    test_results.append({
        "test": test_name,
        "passed": passed,
        "message": message
    })

def login(employee_code: str, pin: str) -> Optional[str]:
    """Login and return access token"""
    try:
        resp = requests.post(f"{BASE_URL}/auth/login", json={
            "employee_code": employee_code,
            "pin": pin
        }, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            return data.get("session", {}).get("access_token")
        else:
            print(f"Login failed for {employee_code}: {resp.status_code} - {resp.text}")
            return None
    except Exception as e:
        print(f"Login error for {employee_code}: {e}")
        return None

def api_call(method: str, endpoint: str, token: str, data: Dict = None, params: Dict = None) -> tuple:
    """Make API call and return (status_code, response_data)"""
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    url = f"{BASE_URL}/{endpoint}"
    try:
        if method == "GET":
            resp = requests.get(url, headers=headers, params=params, timeout=10)
        elif method == "POST":
            resp = requests.post(url, headers=headers, json=data, timeout=10)
        elif method == "PATCH":
            resp = requests.patch(url, headers=headers, json=data, timeout=10)
        elif method == "DELETE":
            resp = requests.delete(url, headers=headers, timeout=10)
        else:
            return (0, {"error": "Invalid method"})
        
        try:
            return (resp.status_code, resp.json())
        except Exception:
            return (resp.status_code, {"text": resp.text})
    except Exception as e:
        return (0, {"error": str(e)})

def create_employee_if_not_exists(owner_token: str, employee_code: str, name: str, role: str, pin: str = "123456") -> bool:
    """Create employee if doesn't exist"""
    # Check if exists
    status, data = api_call("GET", "employees", owner_token)
    if status == 200:
        employees = data.get("employees", [])
        for emp in employees:
            if emp.get("employee_code") == employee_code:
                print(f"Employee {employee_code} already exists")
                return True
    
    # Create
    status, data = api_call("POST", "employees", owner_token, {
        "employee_code": employee_code,
        "name": name,
        "role": role,
        "pin": pin,
        "status": "active"
    })
    if status == 200:
        print(f"Created employee {employee_code}")
        return True
    else:
        print(f"Failed to create employee {employee_code}: {status} - {data}")
        return False

def run_phase2_tests():
    """Run all Phase 2 (Purchasing) tests"""
    print("=" * 80)
    print("PHASE 2 (PURCHASING) BACKEND TESTS")
    print("=" * 80)
    
    # Login as OWNER
    print("\n[SETUP] Logging in as OWNER (OWN001)...")
    owner_token = login("OWN001", "123456")
    if not owner_token:
        print("❌ CRITICAL: Cannot login as OWNER. Aborting tests.")
        return
    log_test("Login as OWNER", True, "OWN001 login successful")
    
    # Setup: Create test item (Ayam)
    print("\n[SETUP] Creating test item (Ayam)...")
    status, units_data = api_call("GET", "units", owner_token)
    kg_unit = next((u for u in units_data.get("units", []) if u["code"] == "KG"), None)
    pcs_unit = next((u for u in units_data.get("units", []) if u["code"] == "PCS"), None)
    box_unit = next((u for u in units_data.get("units", []) if u["code"] == "BOX"), None)
    
    if not kg_unit or not pcs_unit or not box_unit:
        print("❌ CRITICAL: Required units not found")
        return
    
    # Create Ayam item
    status, item_data = api_call("POST", "items", owner_token, {
        "name": f"Ayam Test {int(time.time())}",
        "category": "Bahan Baku",
        "stock_unit_id": kg_unit["id"],
        "purchase_unit_id": kg_unit["id"],
        "minimum_stock": 10,
        "is_active": True
    })
    if status != 200:
        print(f"❌ Failed to create test item: {status} - {item_data}")
        return
    ayam_item = item_data.get("item")
    print(f"✓ Created test item: {ayam_item['name']} (ID: {ayam_item['id']})")
    
    # Create supplier
    print("\n[SETUP] Creating test supplier...")
    status, supplier_data = api_call("POST", "suppliers", owner_token, {
        "name": f"SUP Test {int(time.time())}",
        "contact_name": "Pak Supplier",
        "whatsapp": "6281111111111",
        "phone": "021-1234567",
        "email": "supplier@test.com",
        "address": "Jl. Supplier No. 1",
        "is_active": True
    })
    if status != 200:
        print(f"❌ Failed to create supplier: {status} - {supplier_data}")
        return
    supplier = supplier_data.get("supplier")
    print(f"✓ Created supplier: {supplier['name']} (ID: {supplier['id']})")
    
    # TEST 1: Kitchen membuat purchase request
    print("\n" + "=" * 80)
    print("TEST 1: Kitchen membuat purchase request")
    print("=" * 80)
    
    # Create KITCHEN employee if not exists
    create_employee_if_not_exists(owner_token, "KT2", "Kitchen Staff 2", "KITCHEN")
    
    # Login as KITCHEN
    kitchen_token = login("KT2", "123456")
    if not kitchen_token:
        log_test("TEST 1: Kitchen login", False, "Cannot login as KT2")
    else:
        log_test("TEST 1: Kitchen login", True)
        
        # Create purchase request
        status, pr_data = api_call("POST", "purchase-requests", kitchen_token, {
            "original_text": "Ayam 30 kg",
            "items": [{
                "item_id": ayam_item["id"],
                "quantity": 30,
                "unit_id": kg_unit["id"]
            }],
            "status": "SUBMITTED"
        })
        if status == 200:
            pr = pr_data.get("request")
            log_test("TEST 1: Kitchen create PR", True, f"PR created: {pr['id']}")
        else:
            log_test("TEST 1: Kitchen create PR", False, f"Status {status}: {pr_data}")
    
    # TEST 2: Purchasing melihat request
    print("\n" + "=" * 80)
    print("TEST 2: Purchasing melihat request")
    print("=" * 80)
    
    status, pr_list = api_call("GET", "purchase-requests", owner_token)
    if status == 200:
        requests_list = pr_list.get("requests", [])
        log_test("TEST 2: Get purchase requests", True, f"Found {len(requests_list)} requests")
    else:
        log_test("TEST 2: Get purchase requests", False, f"Status {status}")
    
    # TEST 3-4: Create PO
    print("\n" + "=" * 80)
    print("TEST 3-4: Create PO with idempotency")
    print("=" * 80)
    
    idempotency_key = f"test-po-{int(time.time())}"
    status, po_data = api_call("POST", "purchase-orders", owner_token, {
        "supplier_id": supplier["id"],
        "idempotency_key": idempotency_key,
        "items": [{
            "item_id": ayam_item["id"],
            "ordered_qty": 30,
            "purchase_unit_id": kg_unit["id"],
            "conversion_ratio_snapshot": 1,
            "unit_price": 50000
        }]
    })
    if status == 200:
        po = po_data.get("order")
        log_test("TEST 3: Create PO", True, f"PO created: {po['po_number']}, status={po['status']}")
        po_id = po["id"]
        
        # Get PO items
        status, po_detail = api_call("GET", f"purchase-orders/{po_id}", owner_token)
        if status == 200:
            po_items = po_detail.get("order", {}).get("items", [])
            if po_items:
                poi_id = po_items[0]["id"]
                log_test("TEST 4: Get PO items", True, f"Found {len(po_items)} items")
            else:
                log_test("TEST 4: Get PO items", False, "No items found")
                poi_id = None
        else:
            log_test("TEST 4: Get PO items", False, f"Status {status}")
            poi_id = None
    else:
        log_test("TEST 3: Create PO", False, f"Status {status}: {po_data}")
        po_id = None
        poi_id = None
    
    # TEST 5: Duplicate PO same idempotency_key
    print("\n" + "=" * 80)
    print("TEST 5: Duplicate PO with same idempotency_key")
    print("=" * 80)
    
    if po_id:
        status, po_dup = api_call("POST", "purchase-orders", owner_token, {
            "supplier_id": supplier["id"],
            "idempotency_key": idempotency_key,
            "items": [{
                "item_id": ayam_item["id"],
                "ordered_qty": 30,
                "purchase_unit_id": kg_unit["id"],
                "conversion_ratio_snapshot": 1,
                "unit_price": 50000
            }]
        })
        if status == 200 and po_dup.get("idempotent") == True and po_dup.get("order", {}).get("id") == po_id:
            log_test("TEST 5: PO idempotency", True, "Returned same PO with idempotent=true")
        else:
            log_test("TEST 5: PO idempotency", False, f"Expected idempotent=true, got: {po_dup}")
    else:
        log_test("TEST 5: PO idempotency", False, "No PO to test")
    
    # TEST 6: PO 30 → Receiving 20 → PARTIAL
    print("\n" + "=" * 80)
    print("TEST 6: Partial receiving (20 of 30) → PO status PARTIAL")
    print("=" * 80)
    
    if po_id and poi_id:
        # Get stock before
        status, stock_before = api_call("GET", "stock", owner_token)
        stock_before_qty = 0
        if status == 200:
            for item in stock_before.get("stock", []):
                if item["id"] == ayam_item["id"]:
                    stock_before_qty = item.get("current_qty", 0)
                    break
        
        # Create receiving
        status, rec_data = api_call("POST", "receivings", owner_token, {
            "purchase_order_id": po_id,
            "items": [{
                "purchase_order_item_id": poi_id,
                "received_qty": 20
            }]
        })
        if status == 200:
            receiving = rec_data.get("receiving")
            log_test("TEST 6a: Create receiving (20)", True, f"Receiving created: {receiving['id']}")
            receiving_id_1 = receiving["id"]
            
            # Check PO status
            time.sleep(1)  # Wait for trigger
            status, po_check = api_call("GET", f"purchase-orders/{po_id}", owner_token)
            if status == 200:
                po_status = po_check.get("order", {}).get("status")
                if po_status == "PARTIAL":
                    log_test("TEST 6b: PO status PARTIAL", True, f"PO status: {po_status}")
                else:
                    log_test("TEST 6b: PO status PARTIAL", False, f"Expected PARTIAL, got {po_status}")
            else:
                log_test("TEST 6b: PO status PARTIAL", False, f"Cannot get PO: {status}")
            
            # Check stock increased
            status, stock_after = api_call("GET", "stock", owner_token)
            stock_after_qty = 0
            if status == 200:
                for item in stock_after.get("stock", []):
                    if item["id"] == ayam_item["id"]:
                        stock_after_qty = item.get("current_qty", 0)
                        break
                
                if stock_after_qty == stock_before_qty + 20:
                    log_test("TEST 6c: Stock increased by 20", True, f"Stock: {stock_before_qty} → {stock_after_qty}")
                else:
                    log_test("TEST 6c: Stock increased by 20", False, f"Expected +20, got {stock_before_qty} → {stock_after_qty}")
            else:
                log_test("TEST 6c: Stock increased by 20", False, "Cannot get stock")
        else:
            log_test("TEST 6: Create receiving", False, f"Status {status}: {rec_data}")
            receiving_id_1 = None
    else:
        log_test("TEST 6: Partial receiving", False, "No PO/POI to test")
        receiving_id_1 = None
    
    # TEST 7: Second receiving 10 → COMPLETE
    print("\n" + "=" * 80)
    print("TEST 7: Second receiving (10) → PO status COMPLETE")
    print("=" * 80)
    
    if po_id and poi_id:
        # Get stock before
        status, stock_before = api_call("GET", "stock", owner_token)
        stock_before_qty = 0
        if status == 200:
            for item in stock_before.get("stock", []):
                if item["id"] == ayam_item["id"]:
                    stock_before_qty = item.get("current_qty", 0)
                    break
        
        # Create second receiving
        status, rec_data = api_call("POST", "receivings", owner_token, {
            "purchase_order_id": po_id,
            "items": [{
                "purchase_order_item_id": poi_id,
                "received_qty": 10
            }]
        })
        if status == 200:
            receiving = rec_data.get("receiving")
            log_test("TEST 7a: Create receiving (10)", True, f"Receiving created: {receiving['id']}")
            receiving_id_2 = receiving["id"]
            
            # Check PO status
            time.sleep(1)  # Wait for trigger
            status, po_check = api_call("GET", f"purchase-orders/{po_id}", owner_token)
            if status == 200:
                po_status = po_check.get("order", {}).get("status")
                if po_status == "COMPLETE":
                    log_test("TEST 7b: PO status COMPLETE", True, f"PO status: {po_status}")
                else:
                    log_test("TEST 7b: PO status COMPLETE", False, f"Expected COMPLETE, got {po_status}")
            else:
                log_test("TEST 7b: PO status COMPLETE", False, f"Cannot get PO: {status}")
            
            # Check stock increased by 10
            status, stock_after = api_call("GET", "stock", owner_token)
            stock_after_qty = 0
            if status == 200:
                for item in stock_after.get("stock", []):
                    if item["id"] == ayam_item["id"]:
                        stock_after_qty = item.get("current_qty", 0)
                        break
                
                if stock_after_qty == stock_before_qty + 10:
                    log_test("TEST 7c: Stock increased by 10", True, f"Stock: {stock_before_qty} → {stock_after_qty}")
                else:
                    log_test("TEST 7c: Stock increased by 10", False, f"Expected +10, got {stock_before_qty} → {stock_after_qty}")
            else:
                log_test("TEST 7c: Stock increased by 10", False, "Cannot get stock")
        else:
            log_test("TEST 7: Second receiving", False, f"Status {status}: {rec_data}")
            receiving_id_2 = None
    else:
        log_test("TEST 7: Second receiving", False, "No PO/POI to test")
        receiving_id_2 = None
    
    # TEST 8: Bill with multiple receivings
    print("\n" + "=" * 80)
    print("TEST 8: Bill with multiple receivings")
    print("=" * 80)
    
    if receiving_id_1 and receiving_id_2:
        status, bill_data = api_call("POST", "bills", owner_token, {
            "supplier_id": supplier["id"],
            "total_amount": 10000000,
            "receiving_ids": [receiving_id_1, receiving_id_2]
        })
        if status == 200:
            bill = bill_data.get("bill")
            bill_id = bill["id"]
            log_test("TEST 8a: Create bill", True, f"Bill created: {bill['bill_number']}")
            
            # Check bill has 2 receivings
            status, bills_list = api_call("GET", "bills", owner_token)
            if status == 200:
                found_bill = next((b for b in bills_list.get("bills", []) if b["id"] == bill_id), None)
                if found_bill:
                    receivings_count = len(found_bill.get("receivings", []))
                    if receivings_count == 2:
                        log_test("TEST 8b: Bill has 2 receivings", True, f"Found {receivings_count} receivings")
                    else:
                        log_test("TEST 8b: Bill has 2 receivings", False, f"Expected 2, got {receivings_count}")
                else:
                    log_test("TEST 8b: Bill has 2 receivings", False, "Bill not found in list")
            else:
                log_test("TEST 8b: Bill has 2 receivings", False, f"Cannot get bills: {status}")
        else:
            log_test("TEST 8: Create bill", False, f"Status {status}: {bill_data}")
            bill_id = None
    else:
        log_test("TEST 8: Bill with receivings", False, "No receivings to test")
        bill_id = None
    
    # TEST 9: Payment 5jt → PARTIAL
    print("\n" + "=" * 80)
    print("TEST 9: Payment 5jt → Bill status PARTIAL")
    print("=" * 80)
    
    if bill_id:
        status, pay_data = api_call("POST", "payments", owner_token, {
            "bill_id": bill_id,
            "amount": 5000000,
            "method": "TRANSFER",
            "idempotency_key": f"pt1-{int(time.time())}"
        })
        if status == 200:
            payment = pay_data.get("payment")
            bill_status = pay_data.get("bill_status", {})
            log_test("TEST 9a: Create payment (5jt)", True, f"Payment created: {payment['id']}")
            
            if bill_status.get("status") == "PARTIAL":
                log_test("TEST 9b: Bill status PARTIAL", True, f"Bill status: {bill_status.get('status')}")
            else:
                log_test("TEST 9b: Bill status PARTIAL", False, f"Expected PARTIAL, got {bill_status.get('status')}")
        else:
            log_test("TEST 9: Payment 5jt", False, f"Status {status}: {pay_data}")
    else:
        log_test("TEST 9: Payment", False, "No bill to test")
    
    # TEST 10: Payment 5jt again → PAID
    print("\n" + "=" * 80)
    print("TEST 10: Payment 5jt again → Bill status PAID")
    print("=" * 80)
    
    if bill_id:
        status, pay_data = api_call("POST", "payments", owner_token, {
            "bill_id": bill_id,
            "amount": 5000000,
            "method": "TRANSFER",
            "idempotency_key": f"pt2-{int(time.time())}"
        })
        if status == 200:
            payment = pay_data.get("payment")
            bill_status = pay_data.get("bill_status", {})
            log_test("TEST 10a: Create payment (5jt)", True, f"Payment created: {payment['id']}")
            
            if bill_status.get("status") == "PAID":
                log_test("TEST 10b: Bill status PAID", True, f"Bill status: {bill_status.get('status')}")
            else:
                log_test("TEST 10b: Bill status PAID", False, f"Expected PAID, got {bill_status.get('status')}")
        else:
            log_test("TEST 10: Payment 5jt", False, f"Status {status}: {pay_data}")
    else:
        log_test("TEST 10: Payment", False, "No bill to test")
    
    # TEST 11: Duplicate payment same idempotency_key
    print("\n" + "=" * 80)
    print("TEST 11: Duplicate payment with same idempotency_key")
    print("=" * 80)
    
    if bill_id:
        idem_key = f"pt-idem-{int(time.time())}"
        # First payment
        status, pay1 = api_call("POST", "payments", owner_token, {
            "bill_id": bill_id,
            "amount": 100000,
            "method": "CASH",
            "idempotency_key": idem_key
        })
        if status == 200:
            payment1_id = pay1.get("payment", {}).get("id")
            
            # Duplicate payment
            status, pay2 = api_call("POST", "payments", owner_token, {
                "bill_id": bill_id,
                "amount": 100000,
                "method": "CASH",
                "idempotency_key": idem_key
            })
            if status == 200 and pay2.get("idempotent") == True and pay2.get("payment", {}).get("id") == payment1_id:
                log_test("TEST 11: Payment idempotency", True, "Returned same payment with idempotent=true")
            else:
                log_test("TEST 11: Payment idempotency", False, f"Expected idempotent=true, got: {pay2}")
        else:
            log_test("TEST 11: Payment idempotency", False, f"First payment failed: {status}")
    else:
        log_test("TEST 11: Payment idempotency", False, "No bill to test")
    
    # TEST 12: Payment tidak mengubah stock
    print("\n" + "=" * 80)
    print("TEST 12: Payment does not change stock")
    print("=" * 80)
    
    # Get stock before payment
    status, stock_before = api_call("GET", "stock", owner_token)
    stock_before_items = {}
    if status == 200:
        for item in stock_before.get("stock", []):
            stock_before_items[item["id"]] = item.get("current_qty", 0)
    
    # Create a new bill and payment
    if receiving_id_1:
        status, bill_data = api_call("POST", "bills", owner_token, {
            "supplier_id": supplier["id"],
            "total_amount": 1000000,
            "receiving_ids": [receiving_id_1]
        })
        if status == 200:
            test_bill_id = bill_data.get("bill", {}).get("id")
            
            # Make payment
            status, pay_data = api_call("POST", "payments", owner_token, {
                "bill_id": test_bill_id,
                "amount": 500000,
                "method": "TRANSFER"
            })
            if status == 200:
                # Get stock after payment
                status, stock_after = api_call("GET", "stock", owner_token)
                stock_after_items = {}
                if status == 200:
                    for item in stock_after.get("stock", []):
                        stock_after_items[item["id"]] = item.get("current_qty", 0)
                    
                    # Compare
                    if stock_before_items == stock_after_items:
                        log_test("TEST 12: Payment doesn't change stock", True, "Stock unchanged after payment")
                    else:
                        log_test("TEST 12: Payment doesn't change stock", False, f"Stock changed: {stock_before_items} → {stock_after_items}")
                else:
                    log_test("TEST 12: Payment doesn't change stock", False, "Cannot get stock after")
            else:
                log_test("TEST 12: Payment doesn't change stock", False, f"Payment failed: {status}")
        else:
            log_test("TEST 12: Payment doesn't change stock", False, f"Bill creation failed: {status}")
    else:
        log_test("TEST 12: Payment doesn't change stock", False, "No receiving to test")
    
    # TEST 13: Receiving mengubah stock via engine
    print("\n" + "=" * 80)
    print("TEST 13: Receiving creates stock movement via trigger")
    print("=" * 80)
    
    if ayam_item:
        # Get movements before
        status, movements_before = api_call("GET", "stock/movements", owner_token, params={"item_id": ayam_item["id"]})
        movements_before_count = len(movements_before.get("movements", [])) if status == 200 else 0
        
        # Create a new PO and receiving
        status, po_data = api_call("POST", "purchase-orders", owner_token, {
            "supplier_id": supplier["id"],
            "items": [{
                "item_id": ayam_item["id"],
                "ordered_qty": 5,
                "purchase_unit_id": kg_unit["id"],
                "conversion_ratio_snapshot": 1,
                "unit_price": 50000
            }]
        })
        if status == 200:
            test_po = po_data.get("order")
            test_po_id = test_po["id"]
            
            # Get POI
            status, po_detail = api_call("GET", f"purchase-orders/{test_po_id}", owner_token)
            if status == 200:
                test_poi_id = po_detail.get("order", {}).get("items", [])[0]["id"]
                
                # Create receiving
                status, rec_data = api_call("POST", "receivings", owner_token, {
                    "purchase_order_id": test_po_id,
                    "items": [{
                        "purchase_order_item_id": test_poi_id,
                        "received_qty": 5
                    }]
                })
                if status == 200:
                    time.sleep(1)  # Wait for trigger
                    
                    # Check movements after
                    status, movements_after = api_call("GET", "stock/movements", owner_token, params={"item_id": ayam_item["id"]})
                    if status == 200:
                        movements = movements_after.get("movements", [])
                        # Find auto-created movement
                        auto_movement = next((m for m in movements if m.get("movement_type") == "RECEIVING" and "Auto: receiving" in (m.get("reason") or "")), None)
                        if auto_movement:
                            log_test("TEST 13: Receiving creates stock movement", True, f"Found auto RECEIVING movement: {auto_movement['id']}")
                        else:
                            log_test("TEST 13: Receiving creates stock movement", False, "No auto RECEIVING movement found")
                    else:
                        log_test("TEST 13: Receiving creates stock movement", False, "Cannot get movements after")
                else:
                    log_test("TEST 13: Receiving creates stock movement", False, f"Receiving failed: {status}")
            else:
                log_test("TEST 13: Receiving creates stock movement", False, "Cannot get PO items")
        else:
            log_test("TEST 13: Receiving creates stock movement", False, f"PO creation failed: {status}")
    else:
        log_test("TEST 13: Receiving creates stock movement", False, "No item to test")
    
    # TEST 14: Unit conversion
    print("\n" + "=" * 80)
    print("TEST 14: Unit conversion (5 box × 30 pcs = 150 pcs)")
    print("=" * 80)
    
    # Create new item with stock_unit=PCS
    status, item_data = api_call("POST", "items", owner_token, {
        "name": f"Item PCS Test {int(time.time())}",
        "category": "Test",
        "stock_unit_id": pcs_unit["id"],
        "purchase_unit_id": box_unit["id"],
        "minimum_stock": 0,
        "is_active": True
    })
    if status == 200:
        pcs_item = item_data.get("item")
        
        # Get stock before
        status, stock_before = api_call("GET", "stock", owner_token)
        stock_before_qty = 0
        if status == 200:
            for item in stock_before.get("stock", []):
                if item["id"] == pcs_item["id"]:
                    stock_before_qty = item.get("current_qty", 0)
                    break
        
        # Create PO with conversion_ratio_snapshot=30
        status, po_data = api_call("POST", "purchase-orders", owner_token, {
            "supplier_id": supplier["id"],
            "items": [{
                "item_id": pcs_item["id"],
                "ordered_qty": 5,
                "purchase_unit_id": box_unit["id"],
                "conversion_ratio_snapshot": 30,
                "unit_price": 100000
            }]
        })
        if status == 200:
            conv_po = po_data.get("order")
            conv_po_id = conv_po["id"]
            
            # Get POI
            status, po_detail = api_call("GET", f"purchase-orders/{conv_po_id}", owner_token)
            if status == 200:
                conv_poi_id = po_detail.get("order", {}).get("items", [])[0]["id"]
                
                # Create receiving for 5 boxes
                status, rec_data = api_call("POST", "receivings", owner_token, {
                    "purchase_order_id": conv_po_id,
                    "items": [{
                        "purchase_order_item_id": conv_poi_id,
                        "received_qty": 5
                    }]
                })
                if status == 200:
                    time.sleep(1)  # Wait for trigger
                    
                    # Check stock increased by 150 PCS
                    status, stock_after = api_call("GET", "stock", owner_token)
                    stock_after_qty = 0
                    if status == 200:
                        for item in stock_after.get("stock", []):
                            if item["id"] == pcs_item["id"]:
                                stock_after_qty = item.get("current_qty", 0)
                                break
                        
                        expected_qty = stock_before_qty + 150
                        if stock_after_qty == expected_qty:
                            log_test("TEST 14: Unit conversion", True, f"Stock: {stock_before_qty} → {stock_after_qty} (5 box × 30 = 150 pcs)")
                        else:
                            log_test("TEST 14: Unit conversion", False, f"Expected {expected_qty}, got {stock_after_qty}")
                    else:
                        log_test("TEST 14: Unit conversion", False, "Cannot get stock after")
                else:
                    log_test("TEST 14: Unit conversion", False, f"Receiving failed: {status}")
            else:
                log_test("TEST 14: Unit conversion", False, "Cannot get PO items")
        else:
            log_test("TEST 14: Unit conversion", False, f"PO creation failed: {status}")
    else:
        log_test("TEST 14: Unit conversion", False, f"Item creation failed: {status}")
    
    # TEST 15: Price history
    print("\n" + "=" * 80)
    print("TEST 15: Price history preserves old snapshots")
    print("=" * 80)
    
    if ayam_item and supplier:
        # Create first price
        status, price1 = api_call("POST", "item-suppliers", owner_token, {
            "supplier_id": supplier["id"],
            "item_id": ayam_item["id"],
            "current_price": 50000,
            "price_unit_id": kg_unit["id"]
        })
        if status == 200:
            price1_id = price1.get("price", {}).get("id")
            log_test("TEST 15a: Create first price", True, f"Price: 50000")
            
            time.sleep(1)
            
            # Create second price (should deactivate first)
            status, price2 = api_call("POST", "item-suppliers", owner_token, {
                "supplier_id": supplier["id"],
                "item_id": ayam_item["id"],
                "current_price": 55000,
                "price_unit_id": kg_unit["id"]
            })
            if status == 200:
                log_test("TEST 15b: Create second price", True, f"Price: 55000")
                
                # Check first price is now inactive
                status, prices = api_call("GET", "item-suppliers", owner_token, params={
                    "supplier_id": supplier["id"],
                    "item_id": ayam_item["id"]
                })
                if status == 200:
                    price_list = prices.get("prices", [])
                    old_price = next((p for p in price_list if p["id"] == price1_id), None)
                    if old_price and old_price.get("is_active") == False and old_price.get("effective_to"):
                        log_test("TEST 15c: Old price deactivated", True, f"Old price is_active=false, effective_to set")
                    else:
                        log_test("TEST 15c: Old price deactivated", False, f"Old price: {old_price}")
                    
                    # Verify old PO items still have original price
                    if po_id:
                        status, po_detail = api_call("GET", f"purchase-orders/{po_id}", owner_token)
                        if status == 200:
                            po_items = po_detail.get("order", {}).get("items", [])
                            if po_items and po_items[0].get("unit_price") == 50000:
                                log_test("TEST 15d: Old PO preserves price", True, f"PO item still has unit_price=50000")
                            else:
                                log_test("TEST 15d: Old PO preserves price", False, f"PO item price changed: {po_items[0] if po_items else 'no items'}")
                        else:
                            log_test("TEST 15d: Old PO preserves price", False, "Cannot get PO")
                else:
                    log_test("TEST 15c: Old price deactivated", False, "Cannot get prices")
            else:
                log_test("TEST 15b: Create second price", False, f"Status {status}")
        else:
            log_test("TEST 15: Price history", False, f"First price creation failed: {status}")
    else:
        log_test("TEST 15: Price history", False, "No item/supplier to test")
    
    # TEST 16: RLS per role
    print("\n" + "=" * 80)
    print("TEST 16: RLS enforcement per role")
    print("=" * 80)
    
    # 16a: KITCHEN cannot POST PO
    if kitchen_token:
        status, po_data = api_call("POST", "purchase-orders", kitchen_token, {
            "supplier_id": supplier["id"],
            "items": [{
                "item_id": ayam_item["id"],
                "ordered_qty": 10,
                "purchase_unit_id": kg_unit["id"],
                "conversion_ratio_snapshot": 1,
                "unit_price": 50000
            }]
        })
        if status == 403:
            log_test("TEST 16a: KITCHEN cannot POST PO", True, "Got 403 as expected")
        else:
            log_test("TEST 16a: KITCHEN cannot POST PO", False, f"Expected 403, got {status}")
    else:
        log_test("TEST 16a: KITCHEN cannot POST PO", False, "No kitchen token")
    
    # 16b: KITCHEN cannot POST payment
    if kitchen_token and bill_id:
        status, pay_data = api_call("POST", "payments", kitchen_token, {
            "bill_id": bill_id,
            "amount": 100000,
            "method": "CASH"
        })
        if status == 403:
            log_test("TEST 16b: KITCHEN cannot POST payment", True, "Got 403 as expected")
        else:
            log_test("TEST 16b: KITCHEN cannot POST payment", False, f"Expected 403, got {status}")
    else:
        log_test("TEST 16b: KITCHEN cannot POST payment", False, "No kitchen token or bill")
    
    # 16c: SERVICE cannot POST payment
    create_employee_if_not_exists(owner_token, "SVC2", "Service Staff 2", "SERVICE")
    service_token = login("SVC2", "123456")
    if service_token and bill_id:
        status, pay_data = api_call("POST", "payments", service_token, {
            "bill_id": bill_id,
            "amount": 100000,
            "method": "CASH"
        })
        if status == 403:
            log_test("TEST 16c: SERVICE cannot POST payment", True, "Got 403 as expected")
        else:
            log_test("TEST 16c: SERVICE cannot POST payment", False, f"Expected 403, got {status}")
    else:
        log_test("TEST 16c: SERVICE cannot POST payment", False, "No service token or bill")
    
    # 16d: PURCHASING cannot POST correction
    create_employee_if_not_exists(owner_token, "PUR2", "Purchasing Staff 2", "PURCHASING")
    purchasing_token = login("PUR2", "123456")
    if purchasing_token:
        # Create a movement first
        status, mv_data = api_call("POST", "stock/movements", owner_token, {
            "movement_type": "RECEIVING",
            "item_id": ayam_item["id"],
            "quantity": 10,
            "reason": "Test for correction"
        })
        if status == 200:
            mv_id = mv_data.get("movement", {}).get("id")
            
            # Try correction as PURCHASING
            status, corr_data = api_call("POST", "stock/correction", purchasing_token, {
                "parent_transaction_id": mv_id,
                "quantity": -2,
                "reason": "Test correction"
            })
            if status == 403:
                log_test("TEST 16d: PURCHASING cannot POST correction", True, "Got 403 as expected")
            else:
                log_test("TEST 16d: PURCHASING cannot POST correction", False, f"Expected 403, got {status}")
        else:
            log_test("TEST 16d: PURCHASING cannot POST correction", False, "Cannot create movement for test")
    else:
        log_test("TEST 16d: PURCHASING cannot POST correction", False, "No purchasing token")
    
    # TEST 17: WhatsApp field
    print("\n" + "=" * 80)
    print("TEST 17: WhatsApp field in supplier")
    print("=" * 80)
    
    status, suppliers = api_call("GET", "suppliers", owner_token)
    if status == 200:
        supplier_list = suppliers.get("suppliers", [])
        found_supplier = next((s for s in supplier_list if s["id"] == supplier["id"]), None)
        if found_supplier and found_supplier.get("whatsapp") == "6281111111111":
            log_test("TEST 17: WhatsApp field", True, f"Supplier has whatsapp: {found_supplier.get('whatsapp')}")
        else:
            log_test("TEST 17: WhatsApp field", False, f"WhatsApp field not found or incorrect: {found_supplier}")
    else:
        log_test("TEST 17: WhatsApp field", False, f"Cannot get suppliers: {status}")
    
    # Print summary
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    
    passed = sum(1 for r in test_results if r["passed"])
    total = len(test_results)
    
    print(f"\nTotal: {passed}/{total} tests passed ({passed*100//total}%)")
    print("\nFailed tests:")
    for r in test_results:
        if not r["passed"]:
            print(f"  ❌ {r['test']}: {r['message']}")
    
    return passed == total

if __name__ == "__main__":
    try:
        success = run_phase2_tests()
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"\n❌ CRITICAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
