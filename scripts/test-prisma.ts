import { PrismaClient } from '../src/generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

// Récupération de la variable d'environnement
const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('❌ DATABASE_URL est introuvable. Assurez-vous de charger le fichier .env')
}

const pool = new Pool({ connectionString })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('Test Prisma EVOTASKS — 5 tables\n')
  try {
    const customers = await prisma.customer.findMany({ take: 5 })
    console.log(`✅ customers        : ${customers.length} enregistrements`)
    
    const requests = await prisma.productRequest.findMany({ take: 5 })
    console.log(`✅ product_requests : ${requests.length} enregistrements`)
    
    const history = await prisma.requestHistory.findMany({ take: 5 })
    console.log(`✅ request_history  : ${history.length} enregistrements`)
    
    const stockEvents = await prisma.stockEvent.findMany({ take: 5 })
    console.log(`✅ stock_events     : ${stockEvents.length} enregistrements`)
    
    const notifications = await prisma.notificationLog.findMany({ take: 5 })
    console.log(`✅ notification_logs: ${notifications.length} enregistrements`)
    
    console.log('\n🎉 Tous les modèles Prisma fonctionnent !')
  } catch (error) {
    console.error('❌ Erreur :', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()