# chain

## people

### structure

- `first_name`
- `last_name`
- `email`
- `phone_number`
- `crypto`
    - object with crypto's code as property and an object with the crypto's address and balance as the value
    - eg. {"BTC": {"address": BITCOIN_ADDRESS, "balance": BITCOIN_BALANCE}}
- `facebook_id`
- `coinbase_id`
    - *not defined unless coinbase is linked*
- `coinbase_info`
- `default_currency`
    - code of default currency
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
    - eg. {"BTC": TARGET_BITCOIN_ADDRESS} => public_target_person



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
    - eg. {"BTC": BITCOIN_ADDRESS}
- `default_currency`
- `description`
- `facebook_page_id`
    - *not defined unless facebook is linked*
- `linkedin_page_id`
    - *not defined unless linkedin is linked*
- `amazon_seller_id`
    - *not defined unless amazon is linked*
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
        - `coinbase`
        - `external`
- `from_id`
- `to_id`
    - *defined unless type is external*
- `to_address`
    - *only defined if type is external*
- `tx`
    - *only defined if type is external or coinbase*
- `coinbase_transaction_id`
    - *only defined if type is coinbase*
- `coinbase_info`
    - object with coinbase data
- `relative_currency`
    - values
        - `USD`
        - `EUR`
- `relative_amount`
    - numerical value
    - eg. `100.00`
- `currency`
    - values
        - `BTC`
        - `BCH`
        - `LTC`
        - `ETH`
- `amount`
    - numerical value
    - bitcoin is denoted in Satoshis (smallest fraction of bitcoin)
    - **note:** this value is not set until the transaction is completed, so the acceptor does not subject themselves to
    price fluctuations in the event of a request
- `fee`
    - object describing fee
    - `currency`
    - `amount`
- `category`
- `memo`
- `emoji`
- `timestamp_initiated`
- `timestamp_completed`
- `timestamp_declined`
    - *only defined if transaction was declined*

### rules

- read: if authenticated as from_id or to_id
- write: if authenticated as from_id and authenticated user has crypto_balance >= transaction.crypto_amount + transaction.crypto_fee

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
- `relative_currency`
    - values
        - `USD`
        - `EUR`
- `relative_amount`
    - numerical value
    - eg. `100.00`
- `currency`
    - values
        - `BTC`
        - `BCH`
        - `LTC`
        - `ETH`
- `amount`
    - *only defined if relative_currency == currency*
    - float
    - eg. `100.00`
- `fee`
    - object describing fee
    - `currency`
    - `amount`
- `category`
- `memo`
- `timestamp_initiated`
- `timestamp_completed`
- `timestamp_declined`
    - *only defined if request was declined*

### rules

- read: if authenticated as from_id or to_id
- write: if authenticated as to_id
