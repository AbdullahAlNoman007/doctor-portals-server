const express = require('express')
const cors = require('cors')
const port = process.env.PORT || 5000;
require('dotenv').config()
const jwt = require('jsonwebtoken')
const stripe = require("stripe")(process.env.SECRET_KEY)

const app = express()

app.use(cors())
app.use(express.json())


const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const { application } = require('express');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.22d6kxh.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

function verifyJWT(req, res, next) {
    const authHeader = req.body.token
    if (!authHeader) {
        return res.status(401).send('unauthorized access')
    }
    jwt.verify(authHeader, process.env.ACCESS_TOKEN, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'forbidden access' })
        }
        req.decoded = decoded
        next()
    })
}
function verifyjwt(req, res, next) {
    const authHeader = req.headers.token
    if (!authHeader) {
        return res.status(401).send('unauthorized access')
    }
    jwt.verify(authHeader, process.env.ACCESS_TOKEN, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'forbidden access' })
        }
        req.decoded = decoded
        next()
    })
}

async function run() {
    try {
        const appointmentCollection = client.db('doctorPortal').collection('appointmentoption')
        const bookingsCollection = client.db('doctorPortal').collection('bookings')
        const userCollection = client.db('doctorPortal').collection('Users')
        const doctorCollection = client.db('doctorPortal').collection('Doctors')
        const paymentCollection = client.db('doctorPortal').collection('Payment')
        async function verifyAdmin(req, res, next) {
            const decodedEmail = req.decoded.email
            const filter = { email: decodedEmail }
            const user = await userCollection.findOne(filter)
            if (user?.role !== 'admin') {
                return res.status(403).send({ message: "forbidden access" })
            }
            next()
        }
        app.get('/appointmentSpecialty', async (req, res) => {
            const query = {}
            const result = await appointmentCollection.find(query).project({ name: 1 }).toArray()
            res.send(result)
        })
        app.get('/appointmentOption', async (req, res) => {
            const query = {}
            const date = req.query.date
            const appointmentOption = await appointmentCollection.find(query).toArray()
            const bookingQuery = { SelectedDate: date }
            const alreadybooked = await bookingsCollection.find(bookingQuery).toArray()
            appointmentOption.map(option => {
                const optionBooked = alreadybooked.filter(book => book.TreatmentName === option.name)
                const bookslot = optionBooked.map(book => book.SelectedTime)
                const remainingslots = option.slots.filter(slot => !bookslot.includes(slot))
                option.slots = remainingslots

            })
            res.send(appointmentOption)
        })
        app.post('/create-payment-intent',async(req,res)=>{
            const booking =req.body
            const price= booking.price
            const amount =price*100 
            const paymentIntent=await stripe.paymentIntents.create({
                currency:'usd',
                amount:amount,
                payment_method_types:[
                    'card'
                ]
            })
            res.send({
                clientSecret: paymentIntent.client_secret
            })
        })
        app.post('/booking', async (req, res) => {
            const booking = req.body
            const query =
            {
                SelectedDate: booking.SelectedDate,
                EmailAddress: booking.EmailAddress,
                TreatmentName: booking.TreatmentName
            }
            const alreadybooked = await bookingsCollection.find(query).toArray()
            if (alreadybooked.length) {
                const sms = `You have a booking on ${booking.SelectedDate}`
                res.send({ acknowledged: false, sms })
            }
            const result = await bookingsCollection.insertOne(booking)
            res.send(result)


        })
        app.post('/myappointment', verifyJWT, async (req, res) => {
            const mine = req.body
            const decodedEmail = req.decoded.email
            if (mine.email !== decodedEmail) {
                return res.status(403).send({ message: 'forbidden access' })
            }
            const query = {
                EmailAddress: mine.email,
                SelectedDate: mine.myDate
            }
            const result = await bookingsCollection.find(query).toArray()
            res.send(result)
        })
        app.post('/users', async (req, res) => {
            const user = req.body
            const result = await userCollection.insertOne(user)
            res.send(result)

        })
        app.get('/jwt', async (req, res) => {
            const email = req.query.email
            const query = { email: email }
            const user = await userCollection.findOne(query)
            if (user) {
                const token = jwt.sign({ email }, process.env.ACCESS_TOKEN)
                return res.send({ accessToken: token })
            }
            res.status(403).send({ accessToken: '' })
        })
        app.get('/isadmin/:email', async (req, res) => {
            const email = req.params.email
            const query = { email: email }
            const user = await userCollection.findOne(query)
            res.send({ isadmin: user?.role === 'admin' })
        })
        app.patch('/makeadmin/:id', verifyJWT, async (req, res) => {
            const decodedEmail = req.decoded.email
            const filter = { email: decodedEmail }
            const user = await userCollection.findOne(filter)
            if (user?.role !== 'admin') {
                return res.status(403).send({ message: "forbidden access" })
            }

            const id = req.params.id
            const query = { _id: new ObjectId(id) }
            const options = { upsert: true }
            const updateDoc = {
                $set: {
                    role: 'admin'
                }
            }
            const result = await userCollection.updateOne(query, updateDoc, options)
            res.send(result)
        })
        app.post('/payments',async(req,res)=>{
            const details = req.body 
            const result =await paymentCollection.insertOne(details)
            const id =details.bookingID
            const filter ={_id: new ObjectId(id)}
            const updateDoc={
                $set:{
                    paid:true,
                    transanction_id:details.transactionId
                }
            }
            const update= await bookingsCollection.updateOne(filter,updateDoc)
            res.send(result)
        })
        app.get('/allusers', verifyjwt, async (req, res) => {

            const email = req.headers.email
            const decodedEmail = req.decoded.email
            if (email !== decodedEmail) {

                return res.status(403).send({ message: "forbidden access" })
            }
            const filter = { email: decodedEmail }
            const user = await userCollection.findOne(filter)
            if (user?.role !== 'admin') {
                return res.status(403).send({ message: "forbidden access" })
            }
            const query = {}
            const result = await userCollection.find(query).toArray()
            res.send(result)
        })
        app.post('/doctor', verifyjwt, async (req, res) => {
            const data = req.body
            const result = await doctorCollection.insertOne(data)
            res.send(result)
        })
        app.get('/doctor', verifyjwt, async (req, res) => {
            const query = {}
            const result = await doctorCollection.find(query).toArray()
            res.send(result)
        })
        app.get('/payment/:id',async(req,res)=>{
            const id =req.params.id
            const query= {_id: new ObjectId(id)}
            const result=await bookingsCollection.findOne(query)
            res.send(result) 
        })
        app.delete('/deleteDoctor',verifyjwt,verifyAdmin, async (req, res) => {
            const id = req.query.id
            const query = { _id: new ObjectId(id) }
            const result = await doctorCollection.deleteOne(query)
            res.send(result)
        })
    } finally {

    }
}
run().catch(console.dir);



app.listen(port, () => {
    console.log(`Doctors portal running on ${port}`);
})