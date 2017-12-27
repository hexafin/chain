# chain

## people

### structure

- `first_name`
- `last_name`
- `email`
- `phone_number`
- `crypto`
    - object with crypto's code as property and the cryptocurrency address as the value
    - eg. {"btc": BITCOIN_ADDRESS}
- `facebook_id`
- `coinbase_id`
    - *not defined unless coinbase is linked*
- `picture_url`
    - **do we need this if we are using the graph API?**
- `address`
- `city`
- `state`
- `zip_code`
- `country`
- `joined_date`
    - timestamp of account creation

### rules

- read: if authenticated
    - TODO: distinguish between private and public info
- write: if authenticated as person

### cloud functions

- AuthPerson
    - get person's approval for transaction
- GetPersonFromCrypto
    - get details of person based on input crypto object
    - eg. {"btc": TARGET_BITCOIN_ADDRESS} => public_target_person
    
    

## merchants

### structure

- `name`
- `LBN`
- `admins`
    - object of people that can act as merchant
    - eg. {PERSON1_ID: true, PERSON2_ID: true}
- `email`
    - email on file
- `phone_number`
    - phone number on file
- `crypto`
    - object with crypto's code as property and the cryptocurrency address as the value
    - eg. {"btc": BITCOIN_ADDRESS}
- `description`
- `facebook_page_id`
- `linkedin_page_id`
- `amazon_seller_id`
- `coinbase_id`
    - *not defined unless coinbase is linked*
- `picture_url`
    - **do we need this if we are using the graph API?**
- `address`
- `city`
- `state`
- `zip_code`
- `country`
- `reputation`
    - reputation system like stack overflow (you get points from successful transactions)
- `joined_date`
    - timestamp of account creation

### rules

- read: if authenticated
    - TODO: distinguish between private and public info
- write: if authenticated as merchant

### cloud functions

- GetMerchantFromCrypto
    - get details of merchant based on input crypto object
    - eg. {"btc": TARGET_BITCOIN_ADDRESS} => public_target_merchant



## transactions

all transactions in the transactions collection are final (requests are not final)

### structure

- `type`
    - values
        - `friend`
        - `merchant`
- `from_id`
- `to_id`
- `fiat`
    - values
        - `usd`
        - `eur`
- `amount_fiat`
    - numerical value
    - eg. `100.00`
- `crypto`
    - values
        - `btc`
        - `eth`
- `amount_crypto`
    - numerical value
    - bitcoin is denoted in Satoshis (smallest fraction of bitcoin)
    - **note:** this value is not set until the transaction is completed, so the acceptor does not subject themselves to 
    price fluctuations in the event of a request
- `category`
- `memo`
- `timestamp_initiated`
- `timestamp_completed`
- `timestamp_declined`
    - *only defined if transaction was declined*

### rules

- read: if authenticated as from_id or to_id
- write: if authenticated as from_id

### cloud functions

- InitiateTransaction
    - puts transaction on the queue and calls auth_person to get transaction approval



## requests

### structure

- `type`
    - values
        - `friend`
        - `merchant`
- `from_id`
- `to_id`
- `accepted`
    - boolean
- `declined`
    - boolean
- `number_of_reminders`
- `fiat_or_crypto`
    - what type of currency the request is denominated in
    - values
        - `fiat`
        - `crypto`
- `fiat`
    - *only defined if fiat_or_crypto == "fiat"*
    - values
        - `usd`
        - `eur`
- `amount_fiat`
    - *only defined if fiat_or_crypto == "fiat"*
    - float
    - eg. `100.00`
- `crypto`
    - *only defined if fiat_or_crypto == "crypto"*
    - values
        - `btc`
        - `bch`
        - `eth`
        - `ltc`
- `amount_crypto`
    - *only defined if fiat_or_crypto == "crypto"*
    - float
    - eg. `100.00`
- `category`
- `memo`
- `timestamp_initiated`
- `timestamp_completed`
- `timestamp_declined`
    - *only defined if request was declined*

### rules

- read: if authenticated as from_id or to_id
- write: if authenticated as from_id