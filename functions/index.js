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

var mailgun = require("mailgun-js");
mailgun = mailgun({apiKey: 'd49b4bcf8dda23b0aec8643af05b79ee-4412457b-2a8b0271', domain: 'mg.splash.tech'})

const cryptoUnits = {
    BTC: 100000000,
    ETH: 1000000000000000000,
    GUSD: 100,
    USD: 100,
}

const decimalLengths = {
    BTC: 5,
    ETH: 6,
    USD: 2,
    GUSD: 2,
}

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

const notify = (toId, title, body, data={}) => {
	return new Promise((resolve, reject) => {
		// the payload is what will be delivered to the device(s)
		let payload = {
			notification: {
				body: ""
			},
			data: data
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
		let output = {
			available: false,
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
						output.available = true;
						resolve(output)
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

			firestore.collection("cards").add(transaction).then(tranRef => {

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

exports.generateCard = functions.https.onRequest((req, res) => {
	if (req.method == "POST") {
		try {
			const transactionId = req.body.transactionId;
			firestore.collection("cards").doc(transactionId).update({card: 1111}).then(() => {
				res.status(200).send('Success');
			}).catch(error => {
				res.status(400).send(error);
			})
		} catch (error) {
			res.status(400).send(error);
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
		const decimals = decimalLengths[newTransaction.currency]
		const amount = (parseFloat(newTransaction.amount.subtotal)/cryptoUnits[newTransaction.currency]).toFixed(decimals)

		if (newTransaction.amount.subtotal && newTransaction.fromId && newTransaction.toId) {
			let relativeMessage = ''
			if (typeof newTransaction.relativeAmount != 'undefined' && typeof newTransaction.relativeCurrency != 'undefined') {
				relativeMessage = ' ($' + (parseFloat(newTransaction.relativeAmount)/100).toFixed(2) + ')'
			}

			firestore.collection("users").doc(newTransaction.fromId).get().then(doc => {
				const fromSplashtag = doc.data().splashtag
				const title = '@' + fromSplashtag
				const body = 'sent you ' + amount + ' ' + newTransaction.currency + relativeMessage
				
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


exports.thankTransaction = functions.firestore.document('/transactions/{transactionId}').onUpdate((change, context) => {
	return new Promise((resolve, reject) => {
		const oldData = change.before.data()
		const newData = change.after.data()
		if (oldData.thanked != newData.thanked && newData.thanked) {
			const title = '@' + newData.toSplashtag
			const body = "Said thanks!"
			notify(newData.fromId, title, body).then(() => {
				console.log('thank notification sent: ', newData.fromId, title, body)
				resolve()
			}).catch(e => {
				console.log('thank notification error: ', e)
				reject(e)
			})
		}
	})
})

exports.subscribeEmail = functions.https.onRequest((req, res) => {
	cors(req, res, () => {
		try {
	      axios.request({
			          "method": 'post',
			          "url": "https://us19.api.mailchimp.com/3.0/lists/2b780c32c9/members",
			          "auth": {
			              username: 'api',
			              password: "1cc394b4894552564fc24329a214a66e-us19",
			            },
			          "data": {
			              status: 'subscribed',
			              email_address: req.query.email,
			            }
	      }).then(response => {
	        res.status(200).send()
			})
		} catch (e) {
			res.status(400).send(e);
		}
	});
});

exports.contactUs = functions.https.onRequest((req, res) => {
	cors(req, res, () => {
		try {
		  var data = {
			  from: req.query.name + ' <' + req.query.email + '>',
			  to: 'support@splash.tech',
			  subject: req.query.subject,
			  text: req.query.text
			  };

	     mailgun.messages().send(data, function (e, body) {
	    if (e) {
	      console.log(e)
		  res.status(400).send(e);
	     } else {
	       res.status(200).send()
	       console.log(body);
	     }
		});
		} catch(e) {
	      console.log(e)
		  res.status(400).send(e);
		}
	});
});

exports.linkExtension = functions.https.onRequest((req, res) => {
	if (req.method == "POST") {
		const phoneNumber = req.body.phoneNumber
		const extension_uuid = req.body.extension_uuid
		const pin = (Math.floor(1000 + Math.random() * 9000)).toString();


		try {
		   firestore.collection("users").where("phoneNumber", "==", phoneNumber).get().then(users => {
		   		if (!users.empty) {

				    users.forEach(user => {

					   	const user_data = user.data()

					   	firestore.collection("users").doc(user.id).update({pin}).then(() => {
						   	const notification_data = {
						   		type: 'extension_auth',
						   		extension_uuid,
						   		pin
						   	}
						   	console.log(user.id, phoneNumber, pin)
						   	notify(user.id, "", "Link browser extension", notification_data).then(() => {
						       res.status(200).send()
						   	}).catch(e => {
						   	   console.log(e)
							   res.status(400).send(e);
						   	})
					    }).catch(e => {
					   	   console.log(e)
						   res.status(400).send(e);
					    })

				    });		   			
		   		}
		   }).catch(e => {
		   	  console.log(e)
			  res.status(400).send(e);
		   })
		} catch(e) {
	      console.log(e)
		  res.status(400).send(e);
		}
	}
});

exports.confirmExtension = functions.https.onRequest((req, res) => {
	if (req.method == "POST") {
		const phoneNumber = req.body.phoneNumber
		const extension_uuid = req.body.extension_uuid
		const pin = req.body.pin
		console.log(req.body)

		try {
		   firestore.collection("users").where("phoneNumber", "==", phoneNumber).get().then(users => {
		   		if (!users.empty) {

				    users.forEach(user => {

					   	const user_data = user.data()
					   	console.log(user_data.pin, pin, user_data.pin == pin)
					   	if (user_data.pin == pin) {

						   	firestore.collection("users").doc(user.id).update({pin: null, extension_uuid}).then(() => {
						   		return res.status(200)
							   			.send([user_data.splashtag, user.id])
						    }).catch(e => {
						   	   console.log(e)
							   res.status(400).send(e);
						    })

					   	} else {
					   		 res.status(400).send();
					   	}

				    });		   			
		   		}
		   }).catch(e => {
		   	  console.log(e)
			  res.status(400).send(e);
		   })
		} catch(e) {
	      console.log(e)
		  res.status(400).send(e);
		}
	}
});

