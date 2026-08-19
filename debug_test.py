#!/usr/bin/env python3
"""
Debug specific issues found in backend tests
"""

import requests
import json

BASE_URL = "https://f42cc20a-05fc-4cc2-9953-96abb1429497.preview.emergentagent.com/api"

def login(employee_code: str, pin: str):
    """Login and return session data"""
    response = requests.post(
        f"{BASE_URL}/auth/login",
        json={"employee_code": employee_code, "pin": pin},
        timeout=10
    )
    if response.status_code == 200:
        return response.json().get("session")
    return None

print("="*80)
print("DEBUG TEST 1: SERVICE accessing audit logs")
print("="*80)

# Login as SERVICE
service_session = login("SVC001", "123456")
if service_session:
    service_token = service_session.get("access_token")
    print(f"✓ Logged in as SVC001")
    
    # Check permissions
    response = requests.get(
        f"{BASE_URL}/auth/me",
        headers={"Authorization": f"Bearer {service_token}"},
        timeout=10
    )
    if response.status_code == 200:
        data = response.json()
        permissions = data.get("permissions", [])
        print(f"SERVICE permissions: {permissions}")
        print(f"Has view_audit_log: {'view_audit_log' in permissions}")
    
    # Try to access audit logs
    response = requests.get(
        f"{BASE_URL}/audit-logs",
        headers={"Authorization": f"Bearer {service_token}"},
        timeout=10
    )
    print(f"\nGET /api/audit-logs as SERVICE:")
    print(f"  Status: {response.status_code}")
    print(f"  Response: {response.text[:200]}")
    
    if response.status_code == 200:
        data = response.json()
        logs = data.get("logs", [])
        print(f"  ❌ SECURITY ISSUE: SERVICE can access {len(logs)} audit logs!")
    else:
        print(f"  ✓ Correctly blocked")

print("\n" + "="*80)
print("DEBUG TEST 2: Duplicate item name constraint")
print("="*80)

# Login as OWNER
owner_session = login("OWN001", "123456")
if owner_session:
    owner_token = owner_session.get("access_token")
    print(f"✓ Logged in as OWN001")
    
    # Get units
    response = requests.get(
        f"{BASE_URL}/units",
        headers={"Authorization": f"Bearer {owner_token}"},
        timeout=10
    )
    units = []
    if response.status_code == 200:
        units = response.json().get("units", [])
        print(f"✓ Got {len(units)} units")
    
    unit_id = units[0]["id"] if units else None
    
    # Try to create item with unique name first
    test_item_name = "Debug Test Item Unique 123"
    
    print(f"\nCreating item: {test_item_name}")
    response1 = requests.post(
        f"{BASE_URL}/items",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={
            "name": test_item_name,
            "category": "Test",
            "stock_unit_id": unit_id,
            "purchase_unit_id": unit_id,
            "minimum_stock": 0,
            "is_active": True
        },
        timeout=10
    )
    print(f"  First creation - Status: {response1.status_code}")
    if response1.status_code in [200, 201]:
        item_data = response1.json()
        print(f"  ✓ Item created: {item_data.get('item', {}).get('id')}")
        
        # Now try to create duplicate
        print(f"\nCreating duplicate item: {test_item_name}")
        response2 = requests.post(
            f"{BASE_URL}/items",
            headers={"Authorization": f"Bearer {owner_token}"},
            json={
                "name": test_item_name,
                "category": "Test",
                "stock_unit_id": unit_id,
                "purchase_unit_id": unit_id,
                "minimum_stock": 0,
                "is_active": True
            },
            timeout=10
        )
        print(f"  Second creation - Status: {response2.status_code}")
        print(f"  Response: {response2.text[:300]}")
        
        if "duplicate" in response2.text.lower() or "unique" in response2.text.lower():
            print(f"  ✓ Constraint error detected")
        elif response2.status_code == 403:
            print(f"  ⚠ Got 403 instead of constraint error")
            print(f"  This might be RLS blocking before constraint check")
        else:
            print(f"  ❌ Unexpected response")
    else:
        print(f"  Response: {response1.text[:300]}")
        if "duplicate" in response1.text.lower() or "unique" in response1.text.lower():
            print(f"  Item already exists from previous test")

print("\n" + "="*80)
