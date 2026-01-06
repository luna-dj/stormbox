#!/bin/bash

# JMAP Address Book Fetcher
# Fetches all address books from a JMAP server
#
# Usage:
#   ./get-address-books.sh [base_url] [username] [password]
#   Or set environment variables:
#     JMAP_BASE_URL=https://hivepost.nl
#     JMAP_USERNAME=your-username
#     JMAP_PASSWORD=your-password

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get parameters from command line or environment
BASE_URL="${1:-${JMAP_BASE_URL:-}}"
USERNAME="${2:-${JMAP_USERNAME:-}}"
PASSWORD="${3:-${JMAP_PASSWORD:-}}"

if [ -z "$BASE_URL" ] || [ -z "$USERNAME" ] || [ -z "$PASSWORD" ]; then
    echo -e "${RED}Error: Missing required parameters${NC}"
    echo ""
    echo "Usage:"
    echo "  $0 [base_url] [username] [password]"
    echo ""
    echo "Or set environment variables:"
    echo "  export JMAP_BASE_URL=https://hivepost.nl"
    echo "  export JMAP_USERNAME=your-username"
    echo "  export JMAP_PASSWORD=your-password"
    echo "  $0"
    exit 1
fi

# Remove trailing slash from base URL
BASE_URL="${BASE_URL%/}"

# Session endpoint
SESSION_URL="${BASE_URL}/.well-known/jmap"

echo -e "${GREEN}Fetching JMAP session...${NC}"

# Fetch session (try without auth first, then with auth if needed)
SESSION_RESPONSE=$(curl -sL -w "\n%{http_code}" \
    -H "Accept: application/json" \
    "$SESSION_URL" 2>/dev/null)

HTTP_CODE=$(echo "$SESSION_RESPONSE" | tail -n1)
SESSION_BODY=$(echo "$SESSION_RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "307" ] || [ "$HTTP_CODE" = "308" ]; then
    # Try with authentication (or follow redirects)
    AUTH_HEADER=$(echo -n "${USERNAME}:${PASSWORD}" | base64 -w 0)
    SESSION_RESPONSE=$(curl -sL -w "\n%{http_code}" \
        -H "Accept: application/json" \
        -H "Authorization: Basic ${AUTH_HEADER}" \
        "$SESSION_URL" 2>/dev/null)
    
    HTTP_CODE=$(echo "$SESSION_RESPONSE" | tail -n1)
    SESSION_BODY=$(echo "$SESSION_RESPONSE" | sed '$d')
fi

if [ "$HTTP_CODE" != "200" ]; then
    echo -e "${RED}Error: Failed to fetch session (HTTP $HTTP_CODE)${NC}"
    echo "$SESSION_BODY" | jq '.' 2>/dev/null || echo "$SESSION_BODY"
    exit 1
fi

# Extract API URL and account ID from session
API_URL=$(echo "$SESSION_BODY" | jq -r '.apiUrl // .apiURL // empty')
if [ -z "$API_URL" ] || [ "$API_URL" = "null" ]; then
    echo -e "${RED}Error: No apiUrl found in session response${NC}"
    echo "$SESSION_BODY" | jq '.' 2>/dev/null || echo "$SESSION_BODY"
    exit 1
fi

# Handle relative URLs
if [[ ! "$API_URL" =~ ^https?:// ]]; then
    API_URL="${BASE_URL}${API_URL#/}"
fi

# Try to get accountId from session
ACCOUNT_ID=$(echo "$SESSION_BODY" | jq -r '
    if .primaryAccounts and (.primaryAccounts | type == "object") then
        .primaryAccounts["urn:ietf:params:jmap:contacts"] // 
        .primaryAccounts["urn:ietf:params:jmap:mail"] // 
        (.primaryAccounts | to_entries | .[0].value) // empty
    elif .primaryAccounts and (.primaryAccounts | type == "array") then
        .primaryAccounts[0] // empty
    elif .accounts and (.accounts | type == "object") then
        (.accounts | keys)[0] // empty
    else
        empty
    end
')

AUTH_HEADER=$(echo -n "${USERNAME}:${PASSWORD}" | base64 -w 0)

if [ -z "$ACCOUNT_ID" ] || [ "$ACCOUNT_ID" = "null" ]; then
    echo -e "${YELLOW}Warning: No accountId found in session. Trying to discover from mailboxes...${NC}"
    
    # Try mailbox query without accountId first
    MAILBOX_QUERY=$(cat <<EOF
{
  "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
  "methodCalls": [
    ["Mailbox/query", {
      "limit": 1
    }, "mbq1"]
  ]
}
EOF
)
    
    MAILBOX_RESPONSE=$(curl -sL \
        -H "Content-Type: application/json" \
        -H "Authorization: Basic ${AUTH_HEADER}" \
        -d "$MAILBOX_QUERY" \
        "$API_URL" 2>/dev/null)
    
    # Check if we got accountId from the response
    ACCOUNT_ID=$(echo "$MAILBOX_RESPONSE" | jq -r '
        .methodResponses[]? |
        select(.[0] == "Mailbox/query") |
        .[1].accountId // empty
    ' | head -n1)
    
    # If still no accountId, try Mailbox/get
    if [ -z "$ACCOUNT_ID" ] || [ "$ACCOUNT_ID" = "null" ]; then
        MAILBOX_GET=$(cat <<EOF
{
  "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
  "methodCalls": [
    ["Mailbox/get", {
      "ids": null
    }, "mbg1"]
  ]
}
EOF
)
        
        MAILBOX_RESPONSE=$(curl -sL \
            -H "Content-Type: application/json" \
            -H "Authorization: Basic ${AUTH_HEADER}" \
            -d "$MAILBOX_GET" \
            "$API_URL" 2>/dev/null)
        
        ACCOUNT_ID=$(echo "$MAILBOX_RESPONSE" | jq -r '
            .methodResponses[]? |
            select(.[0] == "Mailbox/get") |
            .[1].accountId // empty
        ' | head -n1)
    fi
    
    # If still no accountId, try username variations
    if [ -z "$ACCOUNT_ID" ] || [ "$ACCOUNT_ID" = "null" ]; then
        echo -e "${YELLOW}Trying username-based accountId discovery...${NC}"
        
        # Extract local part from email
        USERNAME_LOCAL=$(echo "$USERNAME" | cut -d'@' -f1)
        
        # Try different username variations
        for POSSIBLE_ID in "$USERNAME" "$USERNAME_LOCAL"; do
            echo -e "${YELLOW}  Trying accountId: $POSSIBLE_ID${NC}"
            
            TEST_QUERY=$(cat <<EOF
{
  "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
  "methodCalls": [
    ["Mailbox/query", {
      "accountId": "$POSSIBLE_ID",
      "limit": 1
    }, "mbq2"]
  ]
}
EOF
)
            
            TEST_RESPONSE=$(curl -sL \
                -H "Content-Type: application/json" \
                -H "Authorization: Basic ${AUTH_HEADER}" \
                -d "$TEST_QUERY" \
                "$API_URL" 2>/dev/null)
            
            # Check if this accountId works (no error)
            ERROR=$(echo "$TEST_RESPONSE" | jq -r '
                .methodResponses[]? |
                select(.[0] == "error") |
                .[1].type // empty
            ' | head -n1)
            
            if [ -z "$ERROR" ] || [ "$ERROR" = "null" ]; then
                ACCOUNT_ID="$POSSIBLE_ID"
                echo -e "${GREEN}  Found working accountId: $ACCOUNT_ID${NC}"
                break
            fi
        done
    fi
    
    if [ -z "$ACCOUNT_ID" ] || [ "$ACCOUNT_ID" = "null" ]; then
        echo -e "${RED}Error: Could not determine accountId${NC}"
        echo -e "${YELLOW}Session response structure:${NC}"
        echo "$SESSION_BODY" | jq '.' 2>/dev/null || echo "$SESSION_BODY"
        exit 1
    fi
fi

echo -e "${GREEN}Using API URL: $API_URL${NC}"
echo -e "${GREEN}Using Account ID: $ACCOUNT_ID${NC}"
echo ""

# Try to query address books
echo -e "${GREEN}Querying address books...${NC}"

# Method 1: Try AddressBook/query (may not be supported)
ADDRESS_BOOK_QUERY=$(cat <<EOF
{
  "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:contacts"],
  "methodCalls": [
    ["AddressBook/query", {
      "accountId": "$ACCOUNT_ID",
      "limit": 100
    }, "abq1"]
  ]
}
EOF
)

QUERY_RESPONSE=$(curl -sL \
    -H "Content-Type: application/json" \
    -H "Authorization: Basic ${AUTH_HEADER}" \
    -d "$ADDRESS_BOOK_QUERY" \
    "$API_URL" 2>/dev/null)

# Check for errors
ERROR=$(echo "$QUERY_RESPONSE" | jq -r '.methodResponses[]? | select(.[0] == "error") | .[1].type // empty' | head -n1)

if [ -n "$ERROR" ] && [ "$ERROR" != "null" ]; then
    echo -e "${YELLOW}AddressBook/query not supported (error: $ERROR)${NC}"
    echo -e "${YELLOW}Trying alternative methods...${NC}"
    
    # Method 2: Try to get address book IDs from existing contacts
    echo -e "${GREEN}Extracting address book IDs from contacts...${NC}"
    
    CONTACT_QUERY=$(cat <<EOF
{
  "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:contacts"],
  "methodCalls": [
    ["ContactCard/query", {
      "accountId": "$ACCOUNT_ID",
      "limit": 1000
    }, "cq1"]
  ]
}
EOF
)
    
    CONTACT_RESPONSE=$(curl -sL \
        -H "Content-Type: application/json" \
        -H "Authorization: Basic ${AUTH_HEADER}" \
        -d "$CONTACT_QUERY" \
        "$API_URL" 2>/dev/null)
    
    CONTACT_IDS=$(echo "$CONTACT_RESPONSE" | jq -r '
        .methodResponses[]? |
        select(.[0] == "ContactCard/query") |
        .[1].ids[]?
    ' | jq -s '.')
    
    if [ -n "$CONTACT_IDS" ] && [ "$CONTACT_IDS" != "[]" ]; then
        # Get contacts to extract address book IDs
        CONTACT_GET=$(cat <<EOF
{
  "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:contacts"],
  "methodCalls": [
    ["ContactCard/get", {
      "accountId": "$ACCOUNT_ID",
      "ids": $CONTACT_IDS,
      "properties": ["id", "addressBookIds"]
    }, "cg1"]
  ]
}
EOF
)
        
        CONTACT_GET_RESPONSE=$(curl -sL \
            -H "Content-Type: application/json" \
            -H "Authorization: Basic ${AUTH_HEADER}" \
            -d "$CONTACT_GET" \
            "$API_URL" 2>/dev/null)
        
        # Extract unique address book IDs
        ADDRESS_BOOK_IDS=$(echo "$CONTACT_GET_RESPONSE" | jq -r '
            .methodResponses[]? |
            select(.[0] == "ContactCard/get") |
            .[1].list[]? |
            .addressBookIds // empty |
            if type == "object" then keys[] else .[] end
        ' | sort -u | jq -s '.')
        
        if [ -n "$ADDRESS_BOOK_IDS" ] && [ "$ADDRESS_BOOK_IDS" != "[]" ]; then
            echo -e "${GREEN}Found address book IDs from contacts: $ADDRESS_BOOK_IDS${NC}"
            
            # Try to get address book details
            ADDRESS_BOOK_GET=$(cat <<EOF
{
  "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:contacts"],
  "methodCalls": [
    ["AddressBook/get", {
      "accountId": "$ACCOUNT_ID",
      "ids": $ADDRESS_BOOK_IDS,
      "properties": ["id", "name", "isDefault", "description"]
    }, "abg1"]
  ]
}
EOF
)
            
            GET_RESPONSE=$(curl -sL \
                -H "Content-Type: application/json" \
                -H "Authorization: Basic ${AUTH_HEADER}" \
                -d "$ADDRESS_BOOK_GET" \
                "$API_URL" 2>/dev/null)
            
            ERROR=$(echo "$GET_RESPONSE" | jq -r '.methodResponses[]? | select(.[0] == "error") | .[1].type // empty' | head -n1)
            
            if [ -z "$ERROR" ] || [ "$ERROR" = "null" ]; then
                ADDRESS_BOOKS=$(echo "$GET_RESPONSE" | jq -r '
                    .methodResponses[]? |
                    select(.[0] == "AddressBook/get") |
                    .[1].list // []
                ')
                
                if [ -n "$ADDRESS_BOOKS" ] && [ "$ADDRESS_BOOKS" != "[]" ]; then
                    echo ""
                    echo -e "${GREEN}Address Books:${NC}"
                    echo "$ADDRESS_BOOKS" | jq '.'
                    
                    # Save to file if requested
                    OUTPUT_FILE="${JMAP_OUTPUT_FILE:-address-books.json}"
                    if [ -n "${JMAP_OUTPUT_FILE:-}" ] || [ "${SAVE_TO_FILE:-0}" = "1" ]; then
                        echo "$ADDRESS_BOOKS" | jq '.' > "$OUTPUT_FILE"
                        echo ""
                        echo -e "${GREEN}Address books saved to: $OUTPUT_FILE${NC}"
                    fi
                    exit 0
                fi
            else
                echo -e "${YELLOW}AddressBook/get failed: $ERROR${NC}"
            fi
        else
            echo -e "${YELLOW}No address book IDs found in contacts${NC}"
        fi
    else
        echo -e "${YELLOW}No contacts found to extract address book IDs from${NC}"
    fi
    
    # Method 3: Try AddressBook/get with null IDs (some servers return all)
    echo -e "${GREEN}Trying AddressBook/get with null IDs...${NC}"
    
    ADDRESS_BOOK_GET_NULL=$(cat <<EOF
{
  "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:contacts"],
  "methodCalls": [
    ["AddressBook/get", {
      "accountId": "$ACCOUNT_ID",
      "ids": null,
      "properties": ["id", "name", "isDefault", "description"]
    }, "abg2"]
  ]
}
EOF
)
    
    GET_NULL_RESPONSE=$(curl -sL \
        -H "Content-Type: application/json" \
        -H "Authorization: Basic ${AUTH_HEADER}" \
        -d "$ADDRESS_BOOK_GET_NULL" \
        "$API_URL" 2>/dev/null)
    
    ERROR=$(echo "$GET_NULL_RESPONSE" | jq -r '.methodResponses[]? | select(.[0] == "error") | .[1].type // empty' | head -n1)
    
    if [ -z "$ERROR" ] || [ "$ERROR" = "null" ]; then
        ADDRESS_BOOKS=$(echo "$GET_NULL_RESPONSE" | jq -r '
            .methodResponses[]? |
            select(.[0] == "AddressBook/get") |
            .[1].list // []
        ')
        
        if [ -n "$ADDRESS_BOOKS" ] && [ "$ADDRESS_BOOKS" != "[]" ]; then
            echo ""
            echo -e "${GREEN}Address Books:${NC}"
            echo "$ADDRESS_BOOKS" | jq '.'
            
            # Save to file if requested
            OUTPUT_FILE="${JMAP_OUTPUT_FILE:-address-books.json}"
            if [ -n "${JMAP_OUTPUT_FILE:-}" ] || [ "${SAVE_TO_FILE:-0}" = "1" ]; then
                echo "$ADDRESS_BOOKS" | jq '.' > "$OUTPUT_FILE"
                echo ""
                echo -e "${GREEN}Address books saved to: $OUTPUT_FILE${NC}"
            fi
            exit 0
        else
            echo -e "${YELLOW}AddressBook/get with null IDs returned no address books${NC}"
        fi
    else
        echo -e "${YELLOW}AddressBook/get with null IDs failed: $ERROR${NC}"
    fi
    
    echo -e "${RED}Could not retrieve address books using any method${NC}"
    echo -e "${YELLOW}The server may not support AddressBook operations via JMAP${NC}"
    echo -e "${YELLOW}Or there may be no address books configured on the server${NC}"
    exit 1
else
    # AddressBook/query worked!
    ADDRESS_BOOK_IDS=$(echo "$QUERY_RESPONSE" | jq -r '
        .methodResponses[]? |
        select(.[0] == "AddressBook/query") |
        .[1].ids[]?
    ' | jq -s '.')
    
    if [ -z "$ADDRESS_BOOK_IDS" ] || [ "$ADDRESS_BOOK_IDS" = "[]" ]; then
        echo -e "${YELLOW}No address books found${NC}"
        exit 0
    fi
    
    # Get address book details
    ADDRESS_BOOK_GET=$(cat <<EOF
{
  "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:contacts"],
  "methodCalls": [
    ["AddressBook/get", {
      "accountId": "$ACCOUNT_ID",
      "ids": $ADDRESS_BOOK_IDS,
      "properties": ["id", "name", "isDefault", "description"]
    }, "abg1"]
  ]
}
EOF
)
    
    GET_RESPONSE=$(curl -sL \
        -H "Content-Type: application/json" \
        -H "Authorization: Basic ${AUTH_HEADER}" \
        -d "$ADDRESS_BOOK_GET" \
        "$API_URL" 2>/dev/null)
    
    ERROR=$(echo "$GET_RESPONSE" | jq -r '.methodResponses[]? | select(.[0] == "error") | .[1].type // empty' | head -n1)
    
    if [ -n "$ERROR" ] && [ "$ERROR" != "null" ]; then
        echo -e "${RED}Error fetching address books: $ERROR${NC}"
        echo "$GET_RESPONSE" | jq '.' 2>/dev/null || echo "$GET_RESPONSE"
        exit 1
    fi
    
    ADDRESS_BOOKS=$(echo "$GET_RESPONSE" | jq -r '
        .methodResponses[]? |
        select(.[0] == "AddressBook/get") |
        .[1].list // []
    ')
    
    echo ""
    echo -e "${GREEN}Address Books:${NC}"
    echo "$ADDRESS_BOOKS" | jq '.'
    
    # Save to file if requested
    OUTPUT_FILE="${JMAP_OUTPUT_FILE:-address-books.json}"
    if [ -n "${JMAP_OUTPUT_FILE:-}" ] || [ "${SAVE_TO_FILE:-0}" = "1" ]; then
        echo "$ADDRESS_BOOKS" | jq '.' > "$OUTPUT_FILE"
        echo ""
        echo -e "${GREEN}Address books saved to: $OUTPUT_FILE${NC}"
    fi
fi
