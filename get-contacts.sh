#!/bin/bash

# JMAP Contact Fetcher
# Fetches all contacts from a JMAP server
#
# Usage:
#   ./get-contacts.sh [base_url] [username] [password]
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

if [ -z "$ACCOUNT_ID" ] || [ "$ACCOUNT_ID" = "null" ]; then
    echo -e "${YELLOW}Warning: No accountId found in session. Trying to discover from mailboxes...${NC}"
    
    AUTH_HEADER=$(echo -n "${USERNAME}:${PASSWORD}" | base64 -w 0)
    
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
    
    # If still no accountId, try username variations (like the JS client does)
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

# Query for contact IDs
echo -e "${GREEN}Querying contacts...${NC}"

CONTACT_QUERY=$(cat <<EOF
{
  "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:contacts"],
  "methodCalls": [
    ["ContactCard/query", {
      "accountId": "$ACCOUNT_ID",
      "limit": 1000,
      "calculateTotal": true
    }, "cq1"]
  ]
}
EOF
)

AUTH_HEADER=$(echo -n "${USERNAME}:${PASSWORD}" | base64 -w 0)
QUERY_RESPONSE=$(curl -sL \
    -H "Content-Type: application/json" \
    -H "Authorization: Basic ${AUTH_HEADER}" \
    -d "$CONTACT_QUERY" \
    "$API_URL" 2>/dev/null)

# Check for errors
ERROR=$(echo "$QUERY_RESPONSE" | jq -r '.methodResponses[]? | select(.[0] == "error") | .[1].type // empty' | head -n1)
if [ -n "$ERROR" ] && [ "$ERROR" != "null" ]; then
    echo -e "${RED}Error querying contacts: $ERROR${NC}"
    ERROR_DESC=$(echo "$QUERY_RESPONSE" | jq -r '.methodResponses[]? | select(.[0] == "error") | .[1].description // empty' | head -n1)
    if [ -n "$ERROR_DESC" ] && [ "$ERROR_DESC" != "null" ]; then
        echo -e "${RED}Error description: $ERROR_DESC${NC}"
    fi
    echo "$QUERY_RESPONSE" | jq '.' 2>/dev/null || echo "$QUERY_RESPONSE"
    exit 1
fi

# Debug: show the query response
echo -e "${YELLOW}Query response:${NC}"
echo "$QUERY_RESPONSE" | jq '.' 2>/dev/null || echo "$QUERY_RESPONSE"
echo ""

CONTACT_IDS=$(echo "$QUERY_RESPONSE" | jq -r '
    .methodResponses[]? |
    select(.[0] == "ContactCard/query") |
    .[1].ids[]?
' | jq -s '.')

if [ -z "$CONTACT_IDS" ] || [ "$CONTACT_IDS" = "[]" ]; then
    echo -e "${YELLOW}No contacts found with accountId: $ACCOUNT_ID${NC}"
    echo -e "${YELLOW}Trying to query without accountId...${NC}"
    
    # Try querying without accountId (some servers allow this)
    CONTACT_QUERY_NO_ACCOUNT=$(cat <<EOF
{
  "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:contacts"],
  "methodCalls": [
    ["ContactCard/query", {
      "limit": 1000
    }, "cq2"]
  ]
}
EOF
)
    
    QUERY_RESPONSE=$(curl -sL \
        -H "Content-Type: application/json" \
        -H "Authorization: Basic ${AUTH_HEADER}" \
        -d "$CONTACT_QUERY_NO_ACCOUNT" \
        "$API_URL" 2>/dev/null)
    
    ERROR=$(echo "$QUERY_RESPONSE" | jq -r '.methodResponses[]? | select(.[0] == "error") | .[1].type // empty' | head -n1)
    if [ -z "$ERROR" ] || [ "$ERROR" = "null" ]; then
        CONTACT_IDS=$(echo "$QUERY_RESPONSE" | jq -r '
            .methodResponses[]? |
            select(.[0] == "ContactCard/query") |
            .[1].ids[]?
        ' | jq -s '.')
        
        # Update accountId if we got a response
        NEW_ACCOUNT_ID=$(echo "$QUERY_RESPONSE" | jq -r '
            .methodResponses[]? |
            select(.[0] == "ContactCard/query") |
            .[1].accountId // empty
        ' | head -n1)
        
        if [ -n "$NEW_ACCOUNT_ID" ] && [ "$NEW_ACCOUNT_ID" != "null" ]; then
            ACCOUNT_ID="$NEW_ACCOUNT_ID"
            echo -e "${GREEN}Found accountId from contact query: $ACCOUNT_ID${NC}"
        fi
    fi
    
    if [ -z "$CONTACT_IDS" ] || [ "$CONTACT_IDS" = "[]" ]; then
        echo -e "${YELLOW}No contacts found${NC}"
        exit 0
    fi
fi

CONTACT_COUNT=$(echo "$CONTACT_IDS" | jq 'length')
echo -e "${GREEN}Found $CONTACT_COUNT contacts${NC}"
echo ""

# Get full contact details
echo -e "${GREEN}Fetching contact details...${NC}"

CONTACT_GET=$(cat <<EOF
{
  "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:contacts"],
  "methodCalls": [
    ["ContactCard/get", {
      "accountId": "$ACCOUNT_ID",
      "ids": $CONTACT_IDS,
      "properties": [
        "id",
        "addressBookIds",
        "name",
        "emails",
        "phone",
        "company",
        "jobTitle",
        "notes",
        "birthday"
      ]
    }, "cg1"]
  ]
}
EOF
)

GET_RESPONSE=$(curl -sL \
    -H "Content-Type: application/json" \
    -H "Authorization: Basic ${AUTH_HEADER}" \
    -d "$CONTACT_GET" \
    "$API_URL" 2>/dev/null)

# Check for errors
ERROR=$(echo "$GET_RESPONSE" | jq -r '.methodResponses[]? | select(.[0] == "error") | .[1].type // empty' | head -n1)
if [ -n "$ERROR" ] && [ "$ERROR" != "null" ]; then
    echo -e "${RED}Error fetching contacts: $ERROR${NC}"
    echo "$GET_RESPONSE" | jq '.' 2>/dev/null || echo "$GET_RESPONSE"
    exit 1
fi

# Extract contacts list
CONTACTS=$(echo "$GET_RESPONSE" | jq -r '
    .methodResponses[]? |
    select(.[0] == "ContactCard/get") |
    .[1].list // []
')

# Output contacts as JSON
echo "$CONTACTS" | jq '.'

# Optionally save to file
OUTPUT_FILE="${JMAP_OUTPUT_FILE:-contacts.json}"
if [ -n "${JMAP_OUTPUT_FILE:-}" ] || [ "${SAVE_TO_FILE:-0}" = "1" ]; then
    echo "$CONTACTS" | jq '.' > "$OUTPUT_FILE"
    echo ""
    echo -e "${GREEN}Contacts saved to: $OUTPUT_FILE${NC}"
fi
