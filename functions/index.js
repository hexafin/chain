let axios = require("axios");

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const appOptions = JSON.parse(process.env.FIREBASE_CONFIG);
appOptions.databaseAuthVariableOverride = {
	uid: "chain"
};
admin.initializeApp(appOptions);
let firestore = admin.firestore();
let moment = require("moment")

// app imports
var twilio = require("twilio");

const algoliasearch = require('algoliasearch');
const algolia = algoliasearch(functions.config().algolia.appid, functions.config().algolia.adminkey);

const cors = require("cors")({ origin: true });

const SATOSHI_CONVERSION = 100000000

/**
 * slack
 * @param title = title of post to slack channel
 * @param subtitle = optional subtitle of post to slack channel
 * @param content = text of post to slack channel
 *
 * **/

const slack = (title, subtitle = null, content) => {
	// write slack post
	let text = "*" + title + "*" + " | " + content;

	if (subtitle != null) {
		text = "*" + title + "*" + " | " + subtitle + " | " + content;
	}
	// POST to slack webhook
	axios
		.post(functions.config().slack.url, { text: text })
		.then(response => {
			return response;
		})
		.catch(error => {
			return error;
		});
};

const notify = (toId, title, body) => {
	return new Promise((resolve, reject) => {
		// the payload is what will be delivered to the device(s)
		let payload = {
			notification: {
				body: ""
			}
		}
		firestore.collection("users").doc(toId).get().then(doc => {
			const pushToken = doc.data().pushToken

			payload.notification.title = title;
			payload.notification.body = body;

			admin.messaging().sendToDevice(pushToken, payload).then(() => {
				resolve()
			}).catch(error => {
				reject(error)
			})
		}).catch(error => {
			reject(error)
		})
	})
}

const validSplashtag = splashtag => {
	// resolves true is splashtag is valid and unused
	return new Promise((resolve, reject) => {
		const now = Math.floor(new Date() / 1000);

		let output = {
			available: false,
			availableUser: false,
			availableWaitlist: false,
			validSplashtag: false
		};

		splashtag = splashtag.toLowerCase();
		if (/^[a-z0-9_-]{3,15}$/.test(splashtag)) {
			output.validSplashtag = true;

			firestore
				.collection("users")
				.where("splashtag", "==", splashtag)
				.get()
				.then(users => {
					if (users.empty) {
						output.availableUser = true;

						firestore
							.collection("waitlist")
							.where("splashtag", "==", splashtag)
							.get()
							.then(waitlist => {
								let anyClaimed = false;
								let anyPending = false;

								if (waitlist.empty) {
									output.available = true;
									output.availableWaitlist = true;
									resolve(output);
								} else {
									waitlist.forEach(doc => {
										const data = doc.data();
										if (data.claimed == true) {
											anyClaimed = true;
										} else if (
											data.timestamp_expires > now
										) {
											anyPending = true;
										}
									});

									if (anyPending || anyClaimed) {
										resolve(output);
									} else {
										output.available = true;
										output.availableWaitlist = true;
										resolve(output);
									}
								}
							})
							.catch(error => {
								reject(error);
							});
					} else {
						resolve(output);
					}
				})
				.catch(error => {
					reject(error);
				});
		} else {
			resolve(output);
		}
	});
};


exports.initializeTransaction = functions.https.onRequest((req, res) => {
	if (req.method == "POST") {
		try {
			const userId = req.body.userId;
			const extensionId = req.body.extensionId
			const relativeAmount = req.body.amount;
			const relativeCurrency = req.body.currency;
			const domain = req.body.domain;

			const transaction = {
				approved: false,
				txId: null,
				cardInformation: null,
				type: 'card',
				timestampInitiated: moment().unix(),
				userId,
				extensionId,
				relativeAmount,
				relativeCurrency,
				domain
			}

			firestore.collection("transactions").add(transaction).then(tranRef => {

				const transactionId = tranRef.id

				firestore.collection("users").doc(userId).get().then(user => {
					const pushToken = user.data().pushToken
					const payload = {
							notification: {
								body: "Approve $" + relativeAmount + " purchase on " + domain,
							},
							data: {
								transactionId,
								relativeAmount,
								domain,
								relativeCurrency
							}
						}

					admin.messaging().sendToDevice(pushToken, payload).then(response => {
							res.status(200).send(transactionId);
						})
						.catch(error => {
							res.status(400).send(error);
						});

				}).catch(error => {
					res.status(400).send(error);
				})
			}).catch(error => {
				res.status(400).send(error);
			})
		} catch (error) {
			res.status(400).send("Error: invalid parameters");
		}
	}
});

exports.percentTaken = functions.https.onRequest((req, res) => {
	cors(req, res, () => {
		try {
			const startDate = new Date(2018, 2, 7, 0, 0);
			const now = new Date();

			const timeDiff = Math.abs(startDate.getTime() - now.getTime());
			const diffDays = Math.ceil(timeDiff / (1000 * 3600 * 24)) % 100;

			res.status(200).send(String(diffDays) + "." + now.getHours() % 10);
		} catch (error) {
			res.status(400).send(error);
		}
	});
});

exports.splashtagAvailable = functions.https.onRequest((req, res) => {
	cors(req, res, () => {
		const splashtag = req.query.splashtag.toLowerCase();
		validSplashtag(splashtag)
			.then(response => {
				res.status(200).send(response);
			})
			.catch(error => {
				res.status(400).send(error);
			});
	});
});

exports.claimSplashtag = functions.https.onRequest((req, res) => {
	cors(req, res, () => {
		const splashtag = req.query.splashtag;
		const phoneNumber = req.query.phone;

		var now = new Date();
		var fiveMinutes = new Date(now.getTime() + 5 * 60000);

		const client = new twilio(
			functions.config().twilio.sid,
			functions.config().twilio.token
		);

		const waitlist = {
			splashtag: splashtag,
			claimed: false,
			phone_number: phoneNumber,
			timestamp_initiated: Math.floor(now / 1000),
			timestamp_expires: Math.floor(fiveMinutes / 1000)
		};

		validSplashtag(splashtag)
			.then(response => {
				if (response.available == true) {
					generateDynamicLink(splashtag, phoneNumber)
						.then(link => {
							const message =
								"Hi @" +
								splashtag +
								"! claim your splashtag within the next 5 minutes by following this link: " +
								link;

							client.messages
								.create({
									body: message,
									to: "+" + phoneNumber,
									from: "+12015834916"
								})
								.then(message => {
									firestore
										.collection("waitlist")
										.add(waitlist)
										.then(() => {
											res.status(200).send(message.sid);
										})
										.catch(error => {
											res.status(400).send(error);
										});
								})
								.catch(error => {
									res.status(400).send(error);
								});
						})
						.catch(error => {
							res.status(400).send(error);
						});
				} else {
					res.status(400).send("Error invalid splashtag");
				}
			})
			.catch(error => {
				res.status(400).send(error);
			});
	});
});

// Updates the algolia search index when new user entries are created or updated.
exports.updateIndex = functions.firestore.document('/users/{userId}').onWrite((change, context) => {

	const index = algolia.initIndex('Users')

	const userId = context.params.userId
	const data = change.after.data()

	// remove index if entry is deleted
	if (!data) {
		return index.deleteObject(userId, (err) => {
			if (err) throw err
			console.log('User removed from algolia index', userId)
	  	})
	}

	data['phone_numbers'] = [data.phoneNumber.slice(1), data.phoneNumber.slice(-10), '0'+data.phoneNumber.slice(-10)]
	data['objectID'] = userId

	return index.saveObject(data, (err, content) => {
		if (err) throw err
		console.log('User added to algolia index', data.objectID) 
	})

});

// Sends notification on transaction creation
exports.notifyTransaction = functions.firestore.document('/transactions/{transactionId}').onCreate((snap, context) => {
	return new Promise ((resolve, reject) => {
		const newTransaction = snap.data()
		const btcAmount = (parseFloat(newTransaction.amount.subtotal)/SATOSHI_CONVERSION).toFixed(6)

		if (newTransaction.amount.subtotal && newTransaction.fromId && newTransaction.toId) {
			let relativeMessage = ''
			if (typeof newTransaction.relativeAmount != 'undefined' && typeof newTransaction.relativeCurrency != 'undefined') {
				relativeMessage = ' ($' + (parseFloat(newTransaction.relativeAmount)/100).toFixed(2) + ')'
			}

			firestore.collection("users").doc(newTransaction.fromId).get().then(doc => {
				const fromSplashtag = doc.data().splashtag
				const title = '@' + fromSplashtag
				const body = 'sent you ' + btcAmount + ' ' + newTransaction.currency + relativeMessage
				
				notify(newTransaction.toId, title, body).then(() => {
					console.log('notification sent: ', newTransaction.toId, title, body)
					resolve()
				}).catch(e => {
					console.log('Notify transaction error: ', e)
					reject(e)
				})
			}).catch(e => {
				console.log('Notify transaction error: ', e)
				reject(e)
			})
		} else {
			console.log('Notification unecessary')
			resolve()
		}
	})
});

exports.subscribeEmail = functions.https.onRequest((req, res) => {
	cors(req, res, () => {
		try {
	      axios.request({
			          "method": 'post',
			          "url": "https://us19.api.mailchimp.com/3.0/lists/2b780c32c9/members",
			          "auth": {
			              username: 'api',
			              password: functions.config().mailchimp.apikey,
			            },
			          "data": {
			              status: 'subscribed',
			              email_address: req.query.email,
			            }
	      }).then(response => {
	        res.status(200).send(response.data)
			}).catch(e => {
		        res.status(400).send(e)
			})
		} catch (e) {
			res.status(400).send(e);
		}
	});
});

