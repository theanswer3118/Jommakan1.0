#!/usr/bin/env python3
"""
Jom Makan Restaurant OS Phase 1B - Stock Engine Backend API Tests
Tests stock movements, corrections, voids, opname, idempotency, concurrency, and RLS.
"""

import requests
import json
import sys
import time
from typing import Dict, Optional
from concurrent.futures import ThreadPoolExecutor, as_completed

# Base URL from environment
BASE_URL = "https://f42cc20a-05fc-4cc2-9953-96abb1429497.preview.emergentagent.com/api"

# Test results tracking
test_results = {
    "passed": [],
    "failed": [],
    "total": 0
}

# Global tokens
owner_token = None
kitchen_token = None
service_token = None

def log_test(name: str, passed: bool, message: str = ""):
    """Log test result"""
    test_results["total"] += 1
    if passed:
        test_results["passed"].append(name)
        print(f"✅ PASS: {name}")
        if message:
            print(f"   {message}")
    else:
        test_results["failed"].append(name)
        print(f"❌ FAIL: {name}")
        if message:
            print(f"   {message}")

def login(employee_code: str, pin: str) -> Optional[Dict]:
    """Login and return session data"""
    try:
        response = requests.post(
            f"{BASE_URL}/auth/login",
            json={"employee_code": employee_code, "pin": pin},
            timeout=10
        )
        if response.status_code == 200:
            data = response.json()
            return data.get("session")
        return None
    except Exception as e:
        print(f"Login error for {employee_code}: {e}")
        return None

def get_auth_header(token: str) -> Dict[str, str]:
    """Get authorization header"""
    return {"Authorization": f"Bearer {token}"}

def create_test_item(token: str, name: str) -> Optional[str]:
    """Create a test item and return its ID"""
    try:
        # Get units first
        response = requests.get(
            f"{BASE_URL}/units",
            headers=get_auth_header(token),
            timeout=10
        )
        if response.status_code != 200:
            print(f"Failed to get units: {response.status_code}")
            return None
        
        units = response.json().get("units", [])
        kg_unit = next((u for u in units if u["code"] == "KG"), None)
        if not kg_unit:
            print("KG unit not found")
            return None
        
        # Create item
        response = requests.post(
            f"{BASE_URL}/items",
            headers=get_auth_header(token),
            json={
                "name": name,
                "category": "Test",
                "stock_unit_id": kg_unit["id"],
                "purchase_unit_id": kg_unit["id"],
                "minimum_stock": 10,
                "is_active": True
            },
            timeout=10
        )
        
        if response.status_code in [200, 201]:
            item = response.json().get("item")
            return item["id"]
        else:
            print(f"Failed to create item: {response.status_code} - {response.text}")
            return None
    except Exception as e:
        print(f"Exception creating item: {e}")
        return None

def get_stock_balance(token: str, item_id: str) -> Optional[float]:
    """Get current stock balance for an item"""
    try:
        response = requests.get(
            f"{BASE_URL}/stock",
            headers=get_auth_header(token),
            timeout=10
        )
        if response.status_code == 200:
            stock = response.json().get("stock", [])
            item = next((s for s in stock if s["id"] == item_id), None)
            if item:
                return float(item.get("current_qty", 0))
        return None
    except Exception as e:
        print(f"Exception getting balance: {e}")
        return None

# ============================================================================
# TEST 1: LEDGER SEQUENCE
# ============================================================================

def test_ledger_sequence():
    """Test basic ledger sequence: RECEIVING, USAGE, WASTE"""
    print("\n" + "="*80)
    print("TEST 1: LEDGER SEQUENCE")
    print("="*80)
    
    # Create test item
    print("\n[1.1] Creating test item for ledger sequence...")
    item_id = create_test_item(owner_token, "Beras Test Ledger")
    if not item_id:
        log_test("Ledger: Create test item", False, "Failed to create test item")
        return
    log_test("Ledger: Create test item", True, f"Created item {item_id}")
    
    # Test RECEIVING +30
    print("\n[1.2] Testing RECEIVING +30...")
    try:
        response = requests.post(
            f"{BASE_URL}/stock/movements",
            headers=get_auth_header(owner_token),
            json={
                "movement_type": "RECEIVING",
                "item_id": item_id,
                "quantity": 30,
                "reason": "Initial stock"
            },
            timeout=10
        )
        if response.status_code == 200:
            data = response.json()
            current_qty = data.get("current_qty")
            if current_qty == 30:
                log_test("Ledger: RECEIVING +30", True, f"Balance = {current_qty}")
            else:
                log_test("Ledger: RECEIVING +30", False, f"Expected balance 30, got {current_qty}")
        else:
            log_test("Ledger: RECEIVING +30", False, f"Status {response.status_code}: {response.text}")
    except Exception as e:
        log_test("Ledger: RECEIVING +30", False, f"Exception: {e}")
    
    # Test USAGE 5
    print("\n[1.3] Testing USAGE 5...")
    try:
        response = requests.post(
            f"{BASE_URL}/stock/movements",
            headers=get_auth_header(owner_token),
            json={
                "movement_type": "USAGE",
                "item_id": item_id,
                "quantity": 5,
                "reason": "Production"
            },
            timeout=10
        )
        if response.status_code == 200:
            data = response.json()
            current_qty = data.get("current_qty")
            if current_qty == 25:
                log_test("Ledger: USAGE 5", True, f"Balance = {current_qty}")
            else:
                log_test("Ledger: USAGE 5", False, f"Expected balance 25, got {current_qty}")
        else:
            log_test("Ledger: USAGE 5", False, f"Status {response.status_code}: {response.text}")
    except Exception as e:
        log_test("Ledger: USAGE 5", False, f"Exception: {e}")
    
    # Test WASTE 2
    print("\n[1.4] Testing WASTE 2...")
    try:
        response = requests.post(
            f"{BASE_URL}/stock/movements",
            headers=get_auth_header(owner_token),
            json={
                "movement_type": "WASTE",
                "item_id": item_id,
                "quantity": 2,
                "reason": "Expired"
            },
            timeout=10
        )
        if response.status_code == 200:
            data = response.json()
            current_qty = data.get("current_qty")
            if current_qty == 23:
                log_test("Ledger: WASTE 2", True, f"Balance = {current_qty}")
            else:
                log_test("Ledger: WASTE 2", False, f"Expected balance 23, got {current_qty}")
        else:
            log_test("Ledger: WASTE 2", False, f"Status {response.status_code}: {response.text}")
    except Exception as e:
        log_test("Ledger: WASTE 2", False, f"Exception: {e}")

# ============================================================================
# TEST 2: CORRECTION
# ============================================================================

def test_correction():
    """Test correction semantics"""
    print("\n" + "="*80)
    print("TEST 2: CORRECTION")
    print("="*80)
    
    # Create test item
    print("\n[2.1] Creating test item for correction...")
    item_id = create_test_item(owner_token, "Beras Test Correction")
    if not item_id:
        log_test("Correction: Create test item", False, "Failed to create test item")
        return
    log_test("Correction: Create test item", True, f"Created item {item_id}")
    
    # RECEIVING +27
    print("\n[2.2] Testing RECEIVING +27...")
    try:
        response = requests.post(
            f"{BASE_URL}/stock/movements",
            headers=get_auth_header(owner_token),
            json={
                "movement_type": "RECEIVING",
                "item_id": item_id,
                "quantity": 27,
                "reason": "Initial stock"
            },
            timeout=10
        )
        if response.status_code == 200:
            data = response.json()
            parent_id = data.get("movement", {}).get("id")
            current_qty = data.get("current_qty")
            if current_qty == 27 and parent_id:
                log_test("Correction: RECEIVING +27", True, f"Balance = {current_qty}, parent_id = {parent_id}")
            else:
                log_test("Correction: RECEIVING +27", False, f"Expected balance 27, got {current_qty}")
                return
        else:
            log_test("Correction: RECEIVING +27", False, f"Status {response.status_code}: {response.text}")
            return
    except Exception as e:
        log_test("Correction: RECEIVING +27", False, f"Exception: {e}")
        return
    
    # CORRECTION -2
    print("\n[2.3] Testing CORRECTION -2...")
    try:
        response = requests.post(
            f"{BASE_URL}/stock/correction",
            headers=get_auth_header(owner_token),
            json={
                "parent_transaction_id": parent_id,
                "quantity": -2,
                "reason": "Kelebihan input"
            },
            timeout=10
        )
        if response.status_code == 200:
            data = response.json()
            movement = data.get("movement", {})
            if movement.get("movement_type") == "CORRECTION" and movement.get("parent_transaction_id") == parent_id:
                # Check balance
                balance = get_stock_balance(owner_token, item_id)
                if balance == 25:
                    log_test("Correction: CORRECTION -2", True, f"Balance = {balance}, movement_type = CORRECTION")
                else:
                    log_test("Correction: CORRECTION -2", False, f"Expected balance 25, got {balance}")
            else:
                log_test("Correction: CORRECTION -2", False, f"Movement type or parent_id mismatch")
        else:
            log_test("Correction: CORRECTION -2", False, f"Status {response.status_code}: {response.text}")
    except Exception as e:
        log_test("Correction: CORRECTION -2", False, f"Exception: {e}")

# ============================================================================
# TEST 3: VOID
# ============================================================================

def test_void():
    """Test void semantics with idempotency"""
    print("\n" + "="*80)
    print("TEST 3: VOID")
    print("="*80)
    
    # Create test item
    print("\n[3.1] Creating test item for void...")
    item_id = create_test_item(owner_token, "Beras Test Void")
    if not item_id:
        log_test("Void: Create test item", False, "Failed to create test item")
        return
    log_test("Void: Create test item", True, f"Created item {item_id}")
    
    # RECEIVING +27
    print("\n[3.2] Testing RECEIVING +27...")
    try:
        response = requests.post(
            f"{BASE_URL}/stock/movements",
            headers=get_auth_header(owner_token),
            json={
                "movement_type": "RECEIVING",
                "item_id": item_id,
                "quantity": 27,
                "reason": "Initial stock"
            },
            timeout=10
        )
        if response.status_code == 200:
            data = response.json()
            parent_id = data.get("movement", {}).get("id")
            current_qty = data.get("current_qty")
            if current_qty == 27 and parent_id:
                log_test("Void: RECEIVING +27", True, f"Balance = {current_qty}, parent_id = {parent_id}")
            else:
                log_test("Void: RECEIVING +27", False, f"Expected balance 27, got {current_qty}")
                return
        else:
            log_test("Void: RECEIVING +27", False, f"Status {response.status_code}: {response.text}")
            return
    except Exception as e:
        log_test("Void: RECEIVING +27", False, f"Exception: {e}")
        return
    
    # VOID
    print("\n[3.3] Testing VOID...")
    try:
        response = requests.post(
            f"{BASE_URL}/stock/void",
            headers=get_auth_header(owner_token),
            json={
                "parent_transaction_id": parent_id,
                "reason": "Salah supplier"
            },
            timeout=10
        )
        if response.status_code == 200:
            data = response.json()
            movement = data.get("movement", {})
            if movement.get("movement_type") == "VOID" and movement.get("quantity") == -27:
                # Check balance
                balance = get_stock_balance(owner_token, item_id)
                if balance == 0:
                    log_test("Void: VOID creates new row", True, f"Balance = {balance}, qty = -27")
                else:
                    log_test("Void: VOID creates new row", False, f"Expected balance 0, got {balance}")
            else:
                log_test("Void: VOID creates new row", False, f"Movement type or quantity mismatch")
        else:
            log_test("Void: VOID creates new row", False, f"Status {response.status_code}: {response.text}")
    except Exception as e:
        log_test("Void: VOID creates new row", False, f"Exception: {e}")
    
    # Verify original row still exists
    print("\n[3.4] Verifying original row still exists...")
    try:
        response = requests.get(
            f"{BASE_URL}/stock/movements?item_id={item_id}",
            headers=get_auth_header(owner_token),
            timeout=10
        )
        if response.status_code == 200:
            movements = response.json().get("movements", [])
            original = next((m for m in movements if m["id"] == parent_id), None)
            if original and original.get("quantity") == 27:
                log_test("Void: Original row preserved", True, f"Original row still has qty = 27")
            else:
                log_test("Void: Original row preserved", False, f"Original row not found or modified")
        else:
            log_test("Void: Original row preserved", False, f"Status {response.status_code}: {response.text}")
    except Exception as e:
        log_test("Void: Original row preserved", False, f"Exception: {e}")
    
    # Test idempotency - second VOID should return same movement
    print("\n[3.5] Testing VOID idempotency...")
    try:
        response = requests.post(
            f"{BASE_URL}/stock/void",
            headers=get_auth_header(owner_token),
            json={
                "parent_transaction_id": parent_id,
                "reason": "Salah supplier"
            },
            timeout=10
        )
        if response.status_code == 200:
            data = response.json()
            if data.get("already_voided") == True:
                log_test("Void: Idempotency (already_voided)", True, f"Second VOID returns already_voided=true")
            else:
                log_test("Void: Idempotency (already_voided)", False, f"Expected already_voided=true, got {data}")
        else:
            log_test("Void: Idempotency (already_voided)", False, f"Status {response.status_code}: {response.text}")
    except Exception as e:
        log_test("Void: Idempotency (already_voided)", False, f"Exception: {e}")

# ============================================================================
# TEST 4: OPNAME
# ============================================================================

def test_opname():
    """Test opname delta calculation"""
    print("\n" + "="*80)
    print("TEST 4: OPNAME")
    print("="*80)
    
    # Create test item
    print("\n[4.1] Creating test item for opname...")
    item_id = create_test_item(owner_token, "Beras Test Opname")
    if not item_id:
        log_test("Opname: Create test item", False, "Failed to create test item")
        return
    log_test("Opname: Create test item", True, f"Created item {item_id}")
    
    # RECEIVING +30
    print("\n[4.2] Testing RECEIVING +30...")
    try:
        response = requests.post(
            f"{BASE_URL}/stock/movements",
            headers=get_auth_header(owner_token),
            json={
                "movement_type": "RECEIVING",
                "item_id": item_id,
                "quantity": 30,
                "reason": "Initial stock"
            },
            timeout=10
        )
        if response.status_code == 200:
            data = response.json()
            current_qty = data.get("current_qty")
            if current_qty == 30:
                log_test("Opname: RECEIVING +30", True, f"Balance = {current_qty}")
            else:
                log_test("Opname: RECEIVING +30", False, f"Expected balance 30, got {current_qty}")
                return
        else:
            log_test("Opname: RECEIVING +30", False, f"Status {response.status_code}: {response.text}")
            return
    except Exception as e:
        log_test("Opname: RECEIVING +30", False, f"Exception: {e}")
        return
    
    # OPNAME physical_qty = 27 (delta = -3)
    print("\n[4.3] Testing OPNAME physical_qty=27...")
    try:
        response = requests.post(
            f"{BASE_URL}/stock/opname",
            headers=get_auth_header(owner_token),
            json={
                "item_id": item_id,
                "physical_qty": 27,
                "reason": "Stock opname bulanan"
            },
            timeout=10
        )
        if response.status_code == 200:
            data = response.json()
            delta = data.get("delta")
            system_qty = data.get("system_qty")
            physical_qty = data.get("physical_qty")
            
            if delta == -3 and system_qty == 30 and physical_qty == 27:
                # Check balance
                balance = get_stock_balance(owner_token, item_id)
                if balance == 27:
                    log_test("Opname: Delta calculation", True, f"Delta = {delta}, balance = {balance}")
                else:
                    log_test("Opname: Delta calculation", False, f"Expected balance 27, got {balance}")
            else:
                log_test("Opname: Delta calculation", False, f"Expected delta=-3, system=30, physical=27, got delta={delta}, system={system_qty}, physical={physical_qty}")
        else:
            log_test("Opname: Delta calculation", False, f"Status {response.status_code}: {response.text}")
    except Exception as e:
        log_test("Opname: Delta calculation", False, f"Exception: {e}")

# ============================================================================
# TEST 5: NEGATIVE STOCK
# ============================================================================

def test_negative_stock():
    """Test negative stock with warning"""
    print("\n" + "="*80)
    print("TEST 5: NEGATIVE STOCK")
    print("="*80)
    
    # Create test item
    print("\n[5.1] Creating test item for negative stock...")
    item_id = create_test_item(owner_token, "Beras Test Negative")
    if not item_id:
        log_test("Negative: Create test item", False, "Failed to create test item")
        return
    log_test("Negative: Create test item", True, f"Created item {item_id}")
    
    # RECEIVING +5
    print("\n[5.2] Testing RECEIVING +5...")
    try:
        response = requests.post(
            f"{BASE_URL}/stock/movements",
            headers=get_auth_header(owner_token),
            json={
                "movement_type": "RECEIVING",
                "item_id": item_id,
                "quantity": 5,
                "reason": "Initial stock"
            },
            timeout=10
        )
        if response.status_code == 200:
            data = response.json()
            current_qty = data.get("current_qty")
            if current_qty == 5:
                log_test("Negative: RECEIVING +5", True, f"Balance = {current_qty}")
            else:
                log_test("Negative: RECEIVING +5", False, f"Expected balance 5, got {current_qty}")
                return
        else:
            log_test("Negative: RECEIVING +5", False, f"Status {response.status_code}: {response.text}")
            return
    except Exception as e:
        log_test("Negative: RECEIVING +5", False, f"Exception: {e}")
        return
    
    # USAGE 8 (should result in -3)
    print("\n[5.3] Testing USAGE 8 (negative stock)...")
    try:
        response = requests.post(
            f"{BASE_URL}/stock/movements",
            headers=get_auth_header(owner_token),
            json={
                "movement_type": "USAGE",
                "item_id": item_id,
                "quantity": 8,
                "reason": "Production"
            },
            timeout=10
        )
        if response.status_code == 200:
            data = response.json()
            current_qty = data.get("current_qty")
            warning = data.get("warning")
            
            if current_qty == -3 and warning == "STOK NEGATIF":
                log_test("Negative: USAGE 8 with warning", True, f"Balance = {current_qty}, warning = {warning}")
            else:
                log_test("Negative: USAGE 8 with warning", False, f"Expected balance -3 with warning, got balance={current_qty}, warning={warning}")
        else:
            log_test("Negative: USAGE 8 with warning", False, f"Status {response.status_code}: {response.text}")
    except Exception as e:
        log_test("Negative: USAGE 8 with warning", False, f"Exception: {e}")
    
    # Verify GET /api/stock shows is_negative=true
    print("\n[5.4] Verifying GET /api/stock shows is_negative=true...")
    try:
        response = requests.get(
            f"{BASE_URL}/stock",
            headers=get_auth_header(owner_token),
            timeout=10
        )
        if response.status_code == 200:
            stock = response.json().get("stock", [])
            item = next((s for s in stock if s["id"] == item_id), None)
            if item and item.get("is_negative") == True and item.get("needs_check") == True:
                log_test("Negative: Stock flags (is_negative, needs_check)", True, f"is_negative={item.get('is_negative')}, needs_check={item.get('needs_check')}")
            else:
                log_test("Negative: Stock flags (is_negative, needs_check)", False, f"Expected is_negative=true, needs_check=true, got {item}")
        else:
            log_test("Negative: Stock flags (is_negative, needs_check)", False, f"Status {response.status_code}: {response.text}")
    except Exception as e:
        log_test("Negative: Stock flags (is_negative, needs_check)", False, f"Exception: {e}")

# ============================================================================
# TEST 6: IDEMPOTENCY
# ============================================================================

def test_idempotency():
    """Test idempotency on movements"""
    print("\n" + "="*80)
    print("TEST 6: IDEMPOTENCY")
    print("="*80)
    
    # Create test item
    print("\n[6.1] Creating test item for idempotency...")
    item_id = create_test_item(owner_token, "Beras Test Idempotency")
    if not item_id:
        log_test("Idempotency: Create test item", False, "Failed to create test item")
        return
    log_test("Idempotency: Create test item", True, f"Created item {item_id}")
    
    # First POST with idempotency_key
    print("\n[6.2] Testing first POST with idempotency_key...")
    idempotency_key = "idem-test-1"
    try:
        response1 = requests.post(
            f"{BASE_URL}/stock/movements",
            headers=get_auth_header(owner_token),
            json={
                "movement_type": "RECEIVING",
                "item_id": item_id,
                "quantity": 10,
                "reason": "Test idempotency",
                "idempotency_key": idempotency_key
            },
            timeout=10
        )
        if response1.status_code == 200:
            data1 = response1.json()
            movement_id1 = data1.get("movement", {}).get("id")
            current_qty1 = data1.get("current_qty")
            if current_qty1 == 10 and movement_id1:
                log_test("Idempotency: First POST", True, f"Balance = {current_qty1}, movement_id = {movement_id1}")
            else:
                log_test("Idempotency: First POST", False, f"Expected balance 10, got {current_qty1}")
                return
        else:
            log_test("Idempotency: First POST", False, f"Status {response1.status_code}: {response1.text}")
            return
    except Exception as e:
        log_test("Idempotency: First POST", False, f"Exception: {e}")
        return
    
    # Second POST with same idempotency_key
    print("\n[6.3] Testing second POST with same idempotency_key...")
    try:
        response2 = requests.post(
            f"{BASE_URL}/stock/movements",
            headers=get_auth_header(owner_token),
            json={
                "movement_type": "RECEIVING",
                "item_id": item_id,
                "quantity": 10,
                "reason": "Test idempotency",
                "idempotency_key": idempotency_key
            },
            timeout=10
        )
        if response2.status_code == 200:
            data2 = response2.json()
            movement_id2 = data2.get("movement", {}).get("id")
            idempotent = data2.get("idempotent")
            
            if idempotent == True and movement_id2 == movement_id1:
                # Check balance hasn't doubled
                balance = get_stock_balance(owner_token, item_id)
                if balance == 10:
                    log_test("Idempotency: Second POST returns same movement", True, f"idempotent=true, same movement_id, balance still 10")
                else:
                    log_test("Idempotency: Second POST returns same movement", False, f"Balance doubled to {balance}")
            else:
                log_test("Idempotency: Second POST returns same movement", False, f"Expected idempotent=true and same movement_id, got idempotent={idempotent}, id1={movement_id1}, id2={movement_id2}")
        else:
            log_test("Idempotency: Second POST returns same movement", False, f"Status {response2.status_code}: {response2.text}")
    except Exception as e:
        log_test("Idempotency: Second POST returns same movement", False, f"Exception: {e}")

# ============================================================================
# TEST 7: CONCURRENT WRITE
# ============================================================================

def test_concurrent_write():
    """Test concurrent writes (10 parallel receiving)"""
    print("\n" + "="*80)
    print("TEST 7: CONCURRENT WRITE")
    print("="*80)
    
    # Create test item
    print("\n[7.1] Creating test item for concurrent write...")
    item_id = create_test_item(owner_token, "Beras Test Concurrent")
    if not item_id:
        log_test("Concurrent: Create test item", False, "Failed to create test item")
        return
    log_test("Concurrent: Create test item", True, f"Created item {item_id}")
    
    # Fire 10 concurrent POSTs
    print("\n[7.2] Firing 10 concurrent RECEIVING +1...")
    
    def post_receiving(index):
        try:
            response = requests.post(
                f"{BASE_URL}/stock/movements",
                headers=get_auth_header(owner_token),
                json={
                    "movement_type": "RECEIVING",
                    "item_id": item_id,
                    "quantity": 1,
                    "reason": f"Concurrent test {index}"
                },
                timeout=10
            )
            return response.status_code == 200
        except Exception as e:
            print(f"   Exception in concurrent POST {index}: {e}")
            return False
    
    try:
        with ThreadPoolExecutor(max_workers=10) as executor:
            futures = [executor.submit(post_receiving, i) for i in range(10)]
            results = [future.result() for future in as_completed(futures)]
        
        success_count = sum(results)
        print(f"   {success_count}/10 POSTs succeeded")
        
        # Check final balance
        time.sleep(1)  # Give DB a moment to settle
        balance = get_stock_balance(owner_token, item_id)
        
        if balance == 10:
            log_test("Concurrent: 10 parallel RECEIVING", True, f"Final balance = {balance}")
        else:
            log_test("Concurrent: 10 parallel RECEIVING", False, f"Expected balance 10, got {balance}")
        
        # Verify SUM(movements) == balance
        response = requests.get(
            f"{BASE_URL}/stock/movements?item_id={item_id}",
            headers=get_auth_header(owner_token),
            timeout=10
        )
        if response.status_code == 200:
            movements = response.json().get("movements", [])
            total = sum(float(m.get("quantity", 0)) for m in movements)
            if total == balance:
                log_test("Concurrent: SUM(movements) == balance", True, f"SUM = {total}, balance = {balance}")
            else:
                log_test("Concurrent: SUM(movements) == balance", False, f"SUM = {total}, balance = {balance}")
        else:
            log_test("Concurrent: SUM(movements) == balance", False, f"Failed to get movements")
    except Exception as e:
        log_test("Concurrent: 10 parallel RECEIVING", False, f"Exception: {e}")

# ============================================================================
# TEST 8: RECONCILIATION
# ============================================================================

def test_reconciliation():
    """Test reconciliation (SUM == balance for all items)"""
    print("\n" + "="*80)
    print("TEST 8: RECONCILIATION")
    print("="*80)
    
    print("\n[8.1] Testing GET /api/stock/reconciliation...")
    try:
        response = requests.get(
            f"{BASE_URL}/stock/reconciliation",
            headers=get_auth_header(owner_token),
            timeout=10
        )
        if response.status_code == 200:
            data = response.json()
            reconciliation = data.get("reconciliation", [])
            
            if len(reconciliation) > 0:
                # Check if all diffs are 0
                all_zero = all(float(r.get("diff", 1)) == 0 for r in reconciliation)
                if all_zero:
                    log_test("Reconciliation: All items diff=0", True, f"Checked {len(reconciliation)} items, all diffs are 0")
                else:
                    non_zero = [r for r in reconciliation if float(r.get("diff", 1)) != 0]
                    log_test("Reconciliation: All items diff=0", False, f"{len(non_zero)} items have non-zero diff: {non_zero}")
            else:
                log_test("Reconciliation: All items diff=0", True, f"No items in reconciliation (empty DB or no movements)")
        else:
            log_test("Reconciliation: All items diff=0", False, f"Status {response.status_code}: {response.text}")
    except Exception as e:
        log_test("Reconciliation: All items diff=0", False, f"Exception: {e}")

# ============================================================================
# TEST 9: LEDGER IMMUTABILITY
# ============================================================================

def test_ledger_immutability():
    """Test ledger immutability (no mutation endpoint exposed)"""
    print("\n" + "="*80)
    print("TEST 9: LEDGER IMMUTABILITY")
    print("="*80)
    
    # Create a movement first
    print("\n[9.1] Creating a movement to test immutability...")
    item_id = create_test_item(owner_token, "Beras Test Immutability")
    if not item_id:
        log_test("Immutability: Create test item", False, "Failed to create test item")
        return
    
    try:
        response = requests.post(
            f"{BASE_URL}/stock/movements",
            headers=get_auth_header(owner_token),
            json={
                "movement_type": "RECEIVING",
                "item_id": item_id,
                "quantity": 10,
                "reason": "Test immutability"
            },
            timeout=10
        )
        if response.status_code == 200:
            movement_id = response.json().get("movement", {}).get("id")
            log_test("Immutability: Create movement", True, f"Created movement {movement_id}")
        else:
            log_test("Immutability: Create movement", False, f"Failed to create movement")
            return
    except Exception as e:
        log_test("Immutability: Create movement", False, f"Exception: {e}")
        return
    
    # Try to PATCH the movement (endpoint should not exist)
    print("\n[9.2] Testing PATCH /api/stock/movements/{id} (should be 404)...")
    try:
        response = requests.patch(
            f"{BASE_URL}/stock/movements/{movement_id}",
            headers=get_auth_header(owner_token),
            json={"quantity": 999},
            timeout=10
        )
        if response.status_code == 404:
            log_test("Immutability: PATCH endpoint absent", True, f"Got 404 as expected (no mutation endpoint)")
        else:
            log_test("Immutability: PATCH endpoint absent", False, f"Expected 404, got {response.status_code}")
    except Exception as e:
        log_test("Immutability: PATCH endpoint absent", False, f"Exception: {e}")
    
    # Try to DELETE the movement (endpoint should not exist)
    print("\n[9.3] Testing DELETE /api/stock/movements/{id} (should be 404)...")
    try:
        response = requests.delete(
            f"{BASE_URL}/stock/movements/{movement_id}",
            headers=get_auth_header(owner_token),
            timeout=10
        )
        if response.status_code == 404:
            log_test("Immutability: DELETE endpoint absent", True, f"Got 404 as expected (no mutation endpoint)")
        else:
            log_test("Immutability: DELETE endpoint absent", False, f"Expected 404, got {response.status_code}")
    except Exception as e:
        log_test("Immutability: DELETE endpoint absent", False, f"Exception: {e}")
    
    # Verify CORRECTION creates NEW row (not modifies parent)
    print("\n[9.4] Verifying CORRECTION creates new row (doesn't modify parent)...")
    try:
        # Get original movement
        response = requests.get(
            f"{BASE_URL}/stock/movements?item_id={item_id}",
            headers=get_auth_header(owner_token),
            timeout=10
        )
        if response.status_code == 200:
            movements = response.json().get("movements", [])
            original = next((m for m in movements if m["id"] == movement_id), None)
            original_qty = original.get("quantity") if original else None
            
            # Create correction
            response = requests.post(
                f"{BASE_URL}/stock/correction",
                headers=get_auth_header(owner_token),
                json={
                    "parent_transaction_id": movement_id,
                    "quantity": -2,
                    "reason": "Test correction immutability"
                },
                timeout=10
            )
            
            if response.status_code == 200:
                # Get movements again
                response = requests.get(
                    f"{BASE_URL}/stock/movements?item_id={item_id}",
                    headers=get_auth_header(owner_token),
                    timeout=10
                )
                if response.status_code == 200:
                    movements = response.json().get("movements", [])
                    original_after = next((m for m in movements if m["id"] == movement_id), None)
                    original_qty_after = original_after.get("quantity") if original_after else None
                    
                    if original_qty == original_qty_after:
                        log_test("Immutability: CORRECTION doesn't modify parent", True, f"Parent qty unchanged: {original_qty}")
                    else:
                        log_test("Immutability: CORRECTION doesn't modify parent", False, f"Parent qty changed from {original_qty} to {original_qty_after}")
                else:
                    log_test("Immutability: CORRECTION doesn't modify parent", False, f"Failed to get movements after correction")
            else:
                log_test("Immutability: CORRECTION doesn't modify parent", False, f"Failed to create correction")
        else:
            log_test("Immutability: CORRECTION doesn't modify parent", False, f"Failed to get original movement")
    except Exception as e:
        log_test("Immutability: CORRECTION doesn't modify parent", False, f"Exception: {e}")

# ============================================================================
# TEST 10: RLS PER ROLE
# ============================================================================

def test_rls_per_role():
    """Test RLS per role (KITCHEN and SERVICE)"""
    print("\n" + "="*80)
    print("TEST 10: RLS PER ROLE")
    print("="*80)
    
    global kitchen_token, service_token
    
    # Create KITCHEN employee (KTC001) if not exists
    print("\n[10.1] Creating KITCHEN employee (KTC001)...")
    try:
        response = requests.post(
            f"{BASE_URL}/employees",
            headers=get_auth_header(owner_token),
            json={
                "employee_code": "KTC001",
                "name": "Kitchen Test",
                "pin": "123456",
                "role": "KITCHEN",
                "status": "active"
            },
            timeout=10
        )
        if response.status_code in [200, 201]:
            log_test("RLS: Create KITCHEN employee", True, f"Created KTC001")
        else:
            if "duplicate" in response.text.lower():
                log_test("RLS: Create KITCHEN employee", True, f"KTC001 already exists")
            else:
                log_test("RLS: Create KITCHEN employee", False, f"Status {response.status_code}: {response.text}")
    except Exception as e:
        log_test("RLS: Create KITCHEN employee", False, f"Exception: {e}")
    
    # Login as KITCHEN
    print("\n[10.2] Login as KITCHEN (KTC001)...")
    session = login("KTC001", "123456")
    if session:
        kitchen_token = session.get("access_token")
        log_test("RLS: KITCHEN login", True, f"Got access_token")
    else:
        log_test("RLS: KITCHEN login", False, f"Failed to login as KTC001")
        return
    
    # Create SERVICE employee (SVC001) if not exists
    print("\n[10.3] Creating SERVICE employee (SVC001)...")
    try:
        response = requests.post(
            f"{BASE_URL}/employees",
            headers=get_auth_header(owner_token),
            json={
                "employee_code": "SVC001",
                "name": "Service Test",
                "pin": "123456",
                "role": "SERVICE",
                "status": "active"
            },
            timeout=10
        )
        if response.status_code in [200, 201]:
            log_test("RLS: Create SERVICE employee", True, f"Created SVC001")
        else:
            if "duplicate" in response.text.lower():
                log_test("RLS: Create SERVICE employee", True, f"SVC001 already exists")
            else:
                log_test("RLS: Create SERVICE employee", False, f"Status {response.status_code}: {response.text}")
    except Exception as e:
        log_test("RLS: Create SERVICE employee", False, f"Exception: {e}")
    
    # Login as SERVICE
    print("\n[10.4] Login as SERVICE (SVC001)...")
    session = login("SVC001", "123456")
    if session:
        service_token = session.get("access_token")
        log_test("RLS: SERVICE login", True, f"Got access_token")
    else:
        log_test("RLS: SERVICE login", False, f"Failed to login as SVC001")
        return
    
    # Create test item for RLS tests
    item_id = create_test_item(owner_token, "Beras Test RLS")
    if not item_id:
        print("Failed to create test item for RLS tests")
        return
    
    # Test KITCHEN: POST /api/stock/correction should fail (no create_correction)
    print("\n[10.5] Testing KITCHEN POST /api/stock/correction (should fail)...")
    try:
        # First create a movement as OWNER
        response = requests.post(
            f"{BASE_URL}/stock/movements",
            headers=get_auth_header(owner_token),
            json={
                "movement_type": "RECEIVING",
                "item_id": item_id,
                "quantity": 10,
                "reason": "Test RLS"
            },
            timeout=10
        )
        parent_id = response.json().get("movement", {}).get("id") if response.status_code == 200 else None
        
        if parent_id:
            # Try correction as KITCHEN
            response = requests.post(
                f"{BASE_URL}/stock/correction",
                headers=get_auth_header(kitchen_token),
                json={
                    "parent_transaction_id": parent_id,
                    "quantity": -2,
                    "reason": "Test RLS"
                },
                timeout=10
            )
            if response.status_code == 403:
                log_test("RLS: KITCHEN cannot POST correction", True, f"Got 403 as expected")
            else:
                log_test("RLS: KITCHEN cannot POST correction", False, f"Expected 403, got {response.status_code}")
        else:
            log_test("RLS: KITCHEN cannot POST correction", False, f"Failed to create parent movement")
    except Exception as e:
        log_test("RLS: KITCHEN cannot POST correction", False, f"Exception: {e}")
    
    # Test KITCHEN: POST /api/stock/movements (RECEIVING) should succeed (has create_stock_movement)
    print("\n[10.6] Testing KITCHEN POST /api/stock/movements (should succeed)...")
    try:
        response = requests.post(
            f"{BASE_URL}/stock/movements",
            headers=get_auth_header(kitchen_token),
            json={
                "movement_type": "RECEIVING",
                "item_id": item_id,
                "quantity": 5,
                "reason": "Test RLS"
            },
            timeout=10
        )
        if response.status_code == 200:
            log_test("RLS: KITCHEN can POST movements", True, f"Got 200 as expected")
        else:
            log_test("RLS: KITCHEN can POST movements", False, f"Expected 200, got {response.status_code}: {response.text}")
    except Exception as e:
        log_test("RLS: KITCHEN can POST movements", False, f"Exception: {e}")
    
    # Test KITCHEN: POST /api/stock/opname should fail (no create_opname)
    print("\n[10.7] Testing KITCHEN POST /api/stock/opname (should fail)...")
    try:
        response = requests.post(
            f"{BASE_URL}/stock/opname",
            headers=get_auth_header(kitchen_token),
            json={
                "item_id": item_id,
                "physical_qty": 10,
                "reason": "Test RLS"
            },
            timeout=10
        )
        if response.status_code == 403:
            log_test("RLS: KITCHEN cannot POST opname", True, f"Got 403 as expected")
        else:
            log_test("RLS: KITCHEN cannot POST opname", False, f"Expected 403, got {response.status_code}")
    except Exception as e:
        log_test("RLS: KITCHEN cannot POST opname", False, f"Exception: {e}")
    
    # Test SERVICE: POST /api/stock/movements should fail (no create_stock_movement)
    print("\n[10.8] Testing SERVICE POST /api/stock/movements (should fail)...")
    try:
        response = requests.post(
            f"{BASE_URL}/stock/movements",
            headers=get_auth_header(service_token),
            json={
                "movement_type": "RECEIVING",
                "item_id": item_id,
                "quantity": 5,
                "reason": "Test RLS"
            },
            timeout=10
        )
        if response.status_code == 403:
            log_test("RLS: SERVICE cannot POST movements", True, f"Got 403 as expected")
        else:
            log_test("RLS: SERVICE cannot POST movements", False, f"Expected 403, got {response.status_code}")
    except Exception as e:
        log_test("RLS: SERVICE cannot POST movements", False, f"Exception: {e}")
    
    # Test SERVICE: GET /api/stock should succeed (has view_stock)
    print("\n[10.9] Testing SERVICE GET /api/stock (should succeed)...")
    try:
        response = requests.get(
            f"{BASE_URL}/stock",
            headers=get_auth_header(service_token),
            timeout=10
        )
        if response.status_code == 200:
            log_test("RLS: SERVICE can GET stock", True, f"Got 200 as expected")
        else:
            log_test("RLS: SERVICE can GET stock", False, f"Expected 200, got {response.status_code}: {response.text}")
    except Exception as e:
        log_test("RLS: SERVICE can GET stock", False, f"Exception: {e}")

# ============================================================================
# MAIN
# ============================================================================

def main():
    """Run all tests"""
    print("\n" + "="*80)
    print("JOM MAKAN RESTAURANT OS - PHASE 1B STOCK ENGINE BACKEND TESTS")
    print("="*80)
    print(f"Base URL: {BASE_URL}")
    print("="*80)
    
    global owner_token
    
    # Login as OWNER first
    print("\nLogging in as OWNER (OWN001)...")
    session = login("OWN001", "123456")
    if not session:
        print("❌ FATAL: Failed to login as OWNER. Cannot proceed with tests.")
        sys.exit(1)
    
    owner_token = session.get("access_token")
    print(f"✅ Logged in as OWNER")
    
    # Run all test suites
    test_ledger_sequence()
    test_correction()
    test_void()
    test_opname()
    test_negative_stock()
    test_idempotency()
    test_concurrent_write()
    test_reconciliation()
    test_ledger_immutability()
    test_rls_per_role()
    
    # Print summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    print(f"Total tests: {test_results['total']}")
    print(f"Passed: {len(test_results['passed'])} ✅")
    print(f"Failed: {len(test_results['failed'])} ❌")
    
    if test_results['failed']:
        print("\nFailed tests:")
        for test in test_results['failed']:
            print(f"  ❌ {test}")
    
    print("="*80)
    
    # Exit with appropriate code
    sys.exit(0 if len(test_results['failed']) == 0 else 1)

if __name__ == "__main__":
    main()
