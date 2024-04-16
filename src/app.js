const express = require('express');
const bodyParser = require('body-parser');
const {sequelize} = require('./model')
const { Op, fn, col } = require('sequelize');
const {getProfile, getAdmin} = require('./middleware/getProfile')
const service = require('./services');
const CONSTANTS = require('../CONSTANTS');
const app = express();
app.use(bodyParser.json());
app.set('sequelize', sequelize)
app.set('models', sequelize.models)

/**
 * FIXED!
 * @returns contract by id
 */
app.get('/contracts/:id',getProfile ,async (req, res) =>{
    try {
        const {Contract} = req.app.get('models')
        const {id} = req.params;
        const idData = req.profile.id;
        const qs = { raw: true, where: {
            id,
            [Op.or]: [
                { ContractorId: idData },
                { ClientId: idData }
            ]
        }};
        const contract = await service.getData(Contract, qs);
        if(contract && contract.length === 0) return res.status(404).end()
        return res.json(contract && contract[0])
    } catch (error) {
        return res.status(500).end()
    }
});

/**
 * @returns Returns a list of contracts belonging to a user (client or contractor), the list should only contain non terminated contracts.
 */
app.get('/contracts',getProfile ,async (req, res) =>{
    try {
        const {Contract} = req.app.get('models')
        const {status} = req.query;
        const idData = req.profile.id;
        const qs = { raw: true, where: {
            status: {
                [Op.not]: CONSTANTS.STATUS_TERMINATED
            },
            [Op.or]: [
                { ContractorId: idData },
                { ClientId: idData }
            ]
        }};
        if (status) {
            qs.where.status = {
                [Op.eq]: status.toLowerCase()
            }
        }
        const contract = await service.getData(Contract, qs);
        if(contract && contract.length === 0) return res.status(404).end()
        return res.json(contract)
    } catch (error) {
        console.log(error);
        return res.status(500).end()
    }
})

/**
 * @returns Get all unpaid jobs for a user (either a client or contractor), for active contracts only.
 */
app.get('/jobs/unpaid',getProfile ,async (req, res) =>{
    try {
        const { Job,  Contract } = req.app.get('models')
        const idData = req.profile.id;
        const qs = {
            raw: true,
            where: {
                paid: null,
            },
            include: [{
                model: Contract,
                where: {
                    status: {
                        [Op.ne]: CONSTANTS.STATUS_TERMINATED
                    },
                    [Op.or]: [
                        { ContractorId: idData },
                        { ClientId: idData }
                    ]
                },
                attributes: []
            }]
        };
        const contract = await service.getData(Job, qs);
        if(contract && contract.length === 0) return res.status(404).end()
        return res.json(contract)
    } catch (error) {
        console.log(error);
        return res.status(500).end()
    }
})

/**
 * @returns Pay for a job, a client can only pay if his balance >= the amount to pay. The amount should be moved from the client's balance
 *                  to the contractor balance.
 */
app.post('/jobs/:job_id/pay',getProfile ,async (req, res) =>{
    const transaction = await sequelize.transaction()
    try {
        const { Job, Contract, Profile } = req.app.get("models");
        const { job_id } = req.params;
        const idData = req.profile;
        if (idData && idData.type === CONSTANTS.CONTRACTOR) return res.status(400).end();
        const jobQs = {
            raw: true,
            include: [{
                model: Contract,
                where: {ClientId: parseInt(idData.id)}
            }],
            where: {id: parseInt(job_id), paid: null}
        };
        let jobEntry = await service.getData(Job, jobQs);
        jobEntry = jobEntry && jobEntry[0] || {}
        // errors
        if (!jobEntry) return res.status(404).end();
        if(idData.balance < jobEntry.price) return res.status(406).end();
        // if (jobEntry && jobEntry.paid === 1) return res.status(404).end();

        await Promise.all([
            service.updateData(Job, {id: job_id}, {paid: true, paymentDate: new Date()}, transaction),
            service.mathematicalOperations(Profile, 'balance', jobEntry.price, jobEntry["Contract.ClientId"], 'dec', transaction),
            service.mathematicalOperations(Profile, 'balance', jobEntry.price, jobEntry["Contract.ContractorId"], 'inc', transaction),
        ])

        await transaction.commit();
        res.status(200).end();
    } catch (error) {
        console.log(error);
        if (transaction) await transaction.rollback();
        return res.status(500).end()
    }
})

/**
 * @returns Deposits money into the the the balance of a client, a client can't deposit more than 25% his total of jobs to pay.
 *                   (at the deposit moment)
 * @assumption assuming any user can pay for other as userId is not required; it can be fetched from middleware
 */
app.post('/balances/deposit/:userId',getProfile ,async (req, res) =>{
    try {
        const {Job, Contract, Profile} = req.app.get('models');
        const { amount } = req.body;
        const { userId } = req.params;
        let getProfile = await service.getData(Profile, {raw: true, where: {id: userId}});
        if (getProfile && getProfile.length === 0) return res.status(404).end();
        getProfile = getProfile && getProfile[0];
        if (getProfile && getProfile.type === CONSTANTS.CONTRACTOR) return res.status(400).end();
        const qs = {
            raw: true,
            include: [{
                attributes: [],
                model: Contract,
                where: { ClientId: getProfile.id }
            }],
            where: {
                paid: null
            },
            attributes: [[fn('SUM', col('price')), 'toBePaid']],
            group: ['Contract.ClientId']
        };
        const getJob = await service.getData(Job, qs);
        console.log("Check AMT", getJob && getJob[0] && getJob[0].toBePaid * (125/100));
        if (getJob && getJob.length === 0 || (amount > getJob[0].toBePaid * (125/100))) return res.status(403).end();
        
        await service.mathematicalOperations(Profile, 'balance', amount, userId, 'inc');
        res.status(200).end();
    } catch (error) {
        console.log(error);
        return res.status(500).end();
    }
})

/**
 * @returns Returns the profession that earned the most money (sum of jobs paid) for any contactor that worked in the query time range.
 * @assumption As there is no user type as Admin, avoiding the `getProfile` middleware and creating a `getAdminMiddleware`
 */
app.post('/admin/best-profession',getAdmin ,async (req, res) =>{
    try {
        const {start, end} = req.query
        const {Job, Contract, Profile} = req.app.get('models')
        const getData = await service.createGeneralQueryForAdmin(Job, Contract, Profile, start, end, 'Contractor', 'Contract.ContractorId');
        if (getData && getData.length === 0) return res.status(404).end();
        return res.status(200).send({
            totalRevenue: getData[0].total,
            contractor: getData[0]["Contract.Contractor.firstName"],
            profession: getData[0]["Contract.Contractor.profession"]
        })
    } catch (error) {
        console.log(error);
        return res.status(500).end();
    }
})

/**
 * @returns returns the clients the paid the most for jobs in the query time period. limit query parameter should be applied, default limit is 2.
 */
app.post('/admin/best-clients',getAdmin ,async (req, res) =>{
    try {
        const {start, end, limit} = req.query
        const {Job, Contract, Profile} = req.app.get('models')
        const getData = await service.createGeneralQueryForAdmin(Job, Contract, Profile, start, end, 'Client', 'Contract.ClientId', limit);
        console.log(getData);
        if (getData && getData.length === 0) return res.status(404).end();
        const resp = getData.map(data => ({
            id: data['Contract.Client.id'],
            totalSpent: data.total,
            clientName: `${data['Contract.Client.firstName']} ${data['Contract.Client.lastName']}`})
        )
        return res.status(200).send(resp)
    } catch (error) {
        console.log(error);
        return res.status(500).end();
    }
})

module.exports = app;
