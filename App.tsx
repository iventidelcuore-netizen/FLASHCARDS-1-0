/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Plus, 
  BookOpen, 
  CheckCircle2, 
  Circle, 
  ArrowLeft, 
  RotateCcw, 
  Trash2, 
  Upload,
  Sparkles,
  Volume2,
  Loader2,
  Edit2,
  User,
  Key,
  LogOut,
  ArrowRight,
  ChevronRight,
  ChevronLeft,
  XCircle,
  AlertCircle
} from 'lucide-react';
import { GoogleGenAI, Type, Modality } from "@google/genai";
import ReactMarkdown from 'react-markdown';
import { Flashcard, Module } from './types';
import { 
  db, 
  auth, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged,
  collection, 
  doc, 
  setDoc, 
  onSnapshot, 
  query, 
  where, 
  getDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  getDocs,
  getDocFromServer,
  User as FirebaseUser
} from './firebase';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Error Boundary Component
function ErrorBoundary({ children }: { children: React.ReactNode }) {
  const [hasError, setHasError] = useState(false);
  const [errorInfo, setErrorInfo] = useState<string | null>(null);

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      if (event.error?.message && event.error.message.startsWith('{')) {
        setHasError(true);
        setErrorInfo(event.error.message);
      }
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  if (hasError) {
    return (
      <div className="min-h-screen bg-[#0A0C10] flex items-center justify-center p-6">
        <div className="bg-[#161B22] border border-red-500/30 rounded-3xl p-8 max-w-md text-center">
          <AlertCircle className="text-red-500 w-12 h-12 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">Something went wrong</h2>
          <p className="text-gray-400 text-sm mb-6">We encountered a database error. Please try refreshing the page.</p>
          <button 
            onClick={() => window.location.reload()}
            className="bg-red-500 hover:bg-red-600 text-white px-6 py-2 rounded-xl font-bold transition-all"
          >
            Refresh Page
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

// Utility for tailwind classes
const cn = (...classes: (string | boolean | undefined)[]) => classes.filter(Boolean).join(' ');

const LESSON_NAMES = [
  "1.1 Greetings & Introductions",
  "1.2 Personal Information",
  "1.3 Numbers & Time",
  "1.4 Family & Relationships",
  "1.5 Countries & Nationalities",
  "1.6 Occupations & Work",
  "1.7 Daily Routine",
  "1.8 Describing People"
];

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [modules, setModules] = useState<Module[]>([]);
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [activeModule, setActiveModule] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isStudyMode, setIsStudyMode] = useState(false);
  const [isDueStudyMode, setIsDueStudyMode] = useState(false);
  const [studyQueue, setStudyQueue] = useState<Flashcard[]>([]);
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [newModuleName, setNewModuleName] = useState('');
  const [newModuleGroup, setNewModuleGroup] = useState('Module 1');
  const [newModuleContent, setNewModuleContent] = useState('');
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [autoAudio, setAutoAudio] = useState(true);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [lastDeletedModule, setLastDeletedModule] = useState<{module: Module, cards: Flashcard[]} | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingModule, setEditingModule] = useState<Module | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [showAddLessonModal, setShowAddLessonModal] = useState(false);
  const [isAddingLesson, setIsAddingLesson] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioCacheRef = useRef<Record<string, ArrayBuffer>>({});

  // Auth state listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (!currentUser) {
        setModules([]);
        setFlashcards([]);
        setIsLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  // Initialize AudioContext on user interaction to comply with browser policies
  const initAudioContext = () => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
          sampleRate: 24000,
        });
      }
      if (audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
      }
    } catch (e) {
      console.error("Failed to initialize AudioContext:", e);
    }
  };


  // Sync with Firestore when user is set
  useEffect(() => {
    if (!user) return;

    setIsLoading(true);
    const qModules = query(collection(db, 'modules'), where('uid', '==', user.uid));
    const unsubscribeModules = onSnapshot(qModules, (snapshot) => {
      const fetchedModules = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Module));
      setModules(fetchedModules);
      setIsLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'modules');
    });

    const qCards = query(collection(db, 'flashcards'), where('uid', '==', user.uid));
    const unsubscribeCards = onSnapshot(qCards, (snapshot) => {
      const fetchedCards = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Flashcard));
      setFlashcards(fetchedCards);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'flashcards');
    });

    return () => {
      unsubscribeModules();
      unsubscribeCards();
    };
  }, [user]);
  const addSpecificLesson = async (lessonIndex: number) => {
    console.log("addSpecificLesson called for index:", lessonIndex);
    if (!user) {
      console.log("No user logged in");
      return;
    }
    
    const lessonName = LESSON_NAMES[lessonIndex];
    const moduleId = `m1-${lessonIndex + 1}-${user.uid}`;

    try {
      console.log("Adding lesson:", lessonName, "with ID:", moduleId);

      // Check if already exists
      if (modules.some(m => m.name === lessonName)) {
        console.log("Lesson already added to local state");
        setShowAddLessonModal(false);
        // If already added, just start studying it
        const existingModule = modules.find(m => m.name === lessonName);
        if (existingModule) {
          startStudy(existingModule.id);
        }
        return;
      }

      setIsAddingLesson(lessonIndex);
      const batch = writeBatch(db);
      
      // Define cards based on index
      const greetings = [
        ["Hello!", "Olá!"],
        ["Good morning!", "Bom dia!"],
        ["Good afternoon!", "Boa tarde!"],
        ["Good evening!", "Boa noite! (chegada)"],
        ["Good night!", "Boa noite! (saída)"],
        ["How are you?", "Como você está?"],
        ["I'm fine, thank you.", "Estou bem, obrigado(a)."],
        ["What's your name?", "Qual é o seu nome?"],
        ["My name is...", "Meu nome é..."],
        ["Nice to meet you.", "Prazer em conhecer você."],
        ["Nice to meet you too.", "O prazer é meu."],
        ["Where are you from?", "De onde você é?"],
        ["I'm from Brazil.", "Eu sou do Brasil."],
        ["How old are you?", "Quantos anos você tem?"],
        ["I am ... years old.", "Eu tenho ... anos."],
        ["Goodbye!", "Adeus! / Tchau!"],
        ["See you later!", "Vejo você mais tarde!"],
        ["Have a nice day!", "Tenha um bom dia!"],
        ["Please.", "Por favor."],
        ["Thank you very much.", "Muito obrigado(a)."]
      ];

      const personalInfo = [
        ["What is your first name?", "Qual é o seu primeiro nome?"],
        ["What is your last name?", "Qual é o seu sobrenome?"],
        ["What is your address?", "Qual é o seu endereço?"],
        ["What is your phone number?", "Qual é o seu número de telefone?"],
        ["What is your email address?", "Qual é o seu endereço de e-mail?"],
        ["Are you married?", "Você é casado(a)?"],
        ["I am single.", "Eu sou solteiro(a)."],
        ["I am married.", "Eu sou casado(a)."],
        ["Do you have any children?", "Você tem filhos?"],
        ["What is your occupation?", "Qual é a sua profissão?"],
        ["I am a student.", "Eu sou estudante."],
        ["Where do you work?", "Onde você trabalha?"],
        ["What is your hobby?", "Qual é o seu hobby?"],
        ["I like listening to music.", "Eu gosto de ouvir música."],
        ["My favorite color is blue.", "Minha cor favorita é azul."],
        ["When is your birthday?", "Quando é o seu aniversário?"],
        ["My birthday is in May.", "Meu aniversário é em maio."],
        ["I live in a house.", "Eu moro em uma casa."],
        ["I live in an apartment.", "Eu moro em um apartamento."],
        ["Nice talking to you.", "Bom conversar com você."]
      ];

      const numbersTime = [
        ["One, two, three", "Um, dois, três"],
        ["Four, five, six", "Quatro, cinco, seis"],
        ["Seven, eight, nine, ten", "Sete, oito, nove, dez"],
        ["What time is it?", "Que horas são?"],
        ["It's one o'clock.", "É uma hora."],
        ["It's half past two.", "São duas e meia."],
        ["It's a quarter to three.", "Faltam quinze para as três."],
        ["Morning", "Manhã"],
        ["Afternoon", "Tarde"],
        ["Evening / Night", "Noite"],
        ["Monday, Tuesday, Wednesday", "Segunda, terça, quarta"],
        ["Thursday, Friday", "Quinta, sexta"],
        ["Saturday, Sunday", "Sábado, domingo"],
        ["January, February, March", "Janeiro, fevereiro, março"],
        ["April, May, June", "Abril, maio, junho"],
        ["July, August, September", "Julho, agosto, setembro"],
        ["October, November, December", "Outubro, novembro, dezembro"],
        ["Today", "Hoje"],
        ["Tomorrow", "Amanhã"],
        ["Yesterday", "Ontem"]
      ];

      const family = [
        ["Father", "Pai"],
        ["Mother", "Mãe"],
        ["Parents", "Pais"],
        ["Son", "Filho"],
        ["Daughter", "Filha"],
        ["Brother", "Irmão"],
        ["Sister", "Irmã"],
        ["Grandfather", "Avô"],
        ["Grandmother", "Avó"],
        ["Uncle", "Tio"],
        ["Aunt", "Tia"],
        ["Cousin", "Primo(a)"],
        ["Nephew", "Sobrinho"],
        ["Niece", "Sobrinha"],
        ["Husband", "Marido"],
        ["Wife", "Esposa"],
        ["Boyfriend", "Namorado"],
        ["Girlfriend", "Namorada"],
        ["Friend", "Amigo(a)"],
        ["Neighbor", "Vizinho(a)"]
      ];

      const countries = [
        ["Brazil - Brazilian", "Brasil - Brasileiro(a)"],
        ["USA - American", "EUA - Americano(a)"],
        ["England - English", "Inglaterra - Inglês/Inglesa"],
        ["France - French", "França - Francês/Francesa"],
        ["Germany - German", "Alemanha - Alemão/Alemã"],
        ["Italy - Italian", "Itália - Italiano(a)"],
        ["Spain - Spanish", "Espanha - Espanhol(a)"],
        ["Japan - Japanese", "Japão - Japonês/Japonesa"],
        ["China - Chinese", "China - Chinês/Chinesa"],
        ["Portugal - Portuguese", "Portugal - Português/Portuguesa"],
        ["Canada - Canadian", "Canadá - Canadense"],
        ["Mexico - Mexican", "México - Mexicano(a)"],
        ["Argentina - Argentine", "Argentina - Argentino(a)"],
        ["Australia - Australian", "Austrália - Australiano(a)"],
        ["I speak Portuguese.", "Eu falo português."],
        ["Do you speak English?", "Você fala inglês?"],
        ["I am learning English.", "Estou aprendendo inglês."],
        ["Where is he from?", "De onde ele é?"],
        ["She is from Italy.", "Ela é da Itália."],
        ["They are from Japan.", "Eles são do Japão."]
      ];

      const occupations = [
        ["Teacher", "Professor(a)"],
        ["Doctor", "Médico(a)"],
        ["Nurse", "Enfermeiro(a)"],
        ["Engineer", "Engenheiro(a)"],
        ["Lawyer", "Advogado(a)"],
        ["Student", "Estudante"],
        ["Waiter / Waitress", "Garçom / Garçonete"],
        ["Chef", "Chef de cozinha"],
        ["Driver", "Motorista"],
        ["Police officer", "Policial"],
        ["Salesperson", "Vendedor(a)"],
        ["Artist", "Artista"],
        ["Musician", "Músico(a)"],
        ["Writer", "Escritor(a)"],
        ["Actor / Actress", "Ator / Atriz"],
        ["Dentist", "Dentista"],
        ["I want to be a...", "Eu quero ser um(a)..."],
        ["My dream job is...", "Meu emprego dos sonhos é..."],
        ["I work from home.", "Eu trabalho de casa."],
        ["Business is good.", "Os negócios vão bem."]
      ];

      const routine = [
        ["I wake up early.", "Eu acordo cedo."],
        ["I brush my teeth.", "Eu escovo meus dentes."],
        ["I have breakfast at 8.", "Eu tomo café da manhã às 8."],
        ["I go to work by bus.", "Eu vou para o trabalho de ônibus."],
        ["I start work at 9 AM.", "Eu começo a trabalhar às 9 da manhã."],
        ["I have lunch at noon.", "Eu almoço ao meio-dia."],
        ["I finish work at 5 PM.", "Eu termino o trabalho às 5 da tarde."],
        ["I get home at 6.", "Eu chego em casa às 6."],
        ["I cook dinner.", "Eu cozinho o jantar."],
        ["I watch TV in the evening.", "Eu assisto TV à noite."],
        ["I go to sleep at 11.", "Eu vou dormir às 11."],
        ["I take a shower.", "Eu tomo um banho."],
        ["I read a book before bed.", "Eu leio um livro antes de dormir."],
        ["I exercise every morning.", "Eu me exercito toda manhã."],
        ["I drink coffee.", "Eu bebo café."],
        ["I check my emails.", "Eu verifico meus e-mails."],
        ["I listen to music.", "Eu ouço música."],
        ["I clean the house.", "Eu limpo a casa."],
        ["I go shopping.", "Eu vou fazer compras."],
        ["I relax on weekends.", "Eu relaxo nos fins de semana."]
      ];

      const describing = [
        ["She is very tall.", "Ela é muito alta."],
        ["He is short and thin.", "Ele é baixo e magro."],
        ["My friend is funny.", "Meu amigo é engraçado."],
        ["She has long hair.", "Ela tem cabelo comprido."],
        ["He has blue eyes.", "Ele tem olhos azuis."],
        ["You look beautiful today.", "Você está linda hoje."],
        ["He is a handsome man.", "Ele é um homem bonito."],
        ["She is very smart.", "Ela é muito inteligente."],
        ["My boss is serious.", "Meu chefe é sério."],
        ["He is a kind person.", "Ele é uma pessoa gentil."],
        ["She is shy.", "Ela é tímida."],
        ["He is very outgoing.", "Ele é muito extrovertido."],
        ["My neighbor is noisy.", "Meu vizinho é barulhento."],
        ["She is young.", "Ela é jovem."],
        ["He is old.", "Ele é velho."],
        ["They are friendly.", "Eles são amigáveis."],
        ["She is wearing a red dress.", "Ela está usando um vestido vermelho."],
        ["He has a beard.", "Ele tem barba."],
        ["She is very creative.", "Ela é muito criativa."],
        ["I am happy.", "Eu estou feliz."]
      ];

      const allData = [greetings, personalInfo, numbersTime, family, countries, occupations, routine, describing];
      const lessonCards = allData[lessonIndex];
      const newCards: Flashcard[] = [];

      const moduleRef = doc(db, 'modules', moduleId);
      batch.set(moduleRef, {
        id: moduleId,
        uid: user.uid,
        name: lessonName,
        content: `Lesson content for ${lessonName}`,
        cardCount: lessonCards.length,
        group: "Module 1",
        unlocked: true
      });

      lessonCards.forEach(([front, back], i) => {
        const cardId = `card-${moduleId}-${i}`;
        const cardRef = doc(db, 'flashcards', cardId);
        const cardData = {
          id: cardId,
          uid: user.uid,
          front,
          back,
          moduleName: lessonName,
          createdAt: Date.now(),
          nextReviewDate: Date.now(),
          interval: 0,
          reps: 0,
          ease: 2.5
        };
        batch.set(cardRef, cardData);
        newCards.push(cardData as Flashcard);
      });

      try {
        await batch.commit();
        console.log("Batch commit successful for lesson:", lessonName);
        
        // Start study mode immediately with the new cards
        setStudyQueue(newCards);
        setCurrentCardIndex(0);
        setIsFlipped(false);
        setIsStudyMode(true);
        setActiveModule(lessonName);
        setIsDueStudyMode(false);
        
        setShowAddLessonModal(false);
      } catch (commitError) {
        handleFirestoreError(commitError, OperationType.WRITE, 'batch-add-lesson');
      } finally {
        setIsAddingLesson(null);
      }
    } catch (error) {
      console.error("Error adding lesson:", error);
      setIsAddingLesson(null);
    }
  };

  const handleGoogleLogin = async () => {
    setIsLoggingIn(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Error logging in with Google:", error);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setModules([]);
      setFlashcards([]);
      setIsStudyMode(false);
      setActiveModule(null);
    } catch (error) {
      console.error("Error logging out:", error);
    }
  };

  useEffect(() => {
    if (isStudyMode && studyQueue.length > 0 && !isFlipped && autoAudio) {
      playAudio(studyQueue[currentCardIndex].front);
    }
  }, [currentCardIndex, isStudyMode, isFlipped, autoAudio, studyQueue]);

  const startStudy = (moduleId?: string) => {
    let cardsToStudy: Flashcard[] = [];
    if (moduleId) {
      const module = modules.find(m => m.id === moduleId);
      if (module) {
        if (!module.unlocked) {
          return;
        }
        // Study due cards from this module
        const now = Date.now();
        cardsToStudy = flashcards.filter(c => c.moduleName === module.name && c.nextReviewDate <= now);
        
        if (cardsToStudy.length === 0) {
          // If no cards are due, we can still allow studying all for this specific module
          // but we'll mark it as "Review All" mode
          cardsToStudy = flashcards.filter(c => c.moduleName === module.name);
        }
        
        setActiveModule(module.name);
        setIsDueStudyMode(false);
      }
    } else {
      // Study all due cards from unlocked modules, limited to 20
      cardsToStudy = flashcards.filter(card => {
        const module = modules.find(m => m.name === card.moduleName);
        return module?.unlocked && card.nextReviewDate <= Date.now();
      }).slice(0, 20);
      setIsDueStudyMode(true);
    }

    if (cardsToStudy.length > 0) {
      setStudyQueue(cardsToStudy);
      setCurrentCardIndex(0);
      setIsFlipped(false);
      setIsStudyMode(true);
    } else {
      alert("No cards to study at the moment!");
    }
  };

  const toggleUnlockModule = async (moduleId: string) => {
    const module = modules.find(m => m.id === moduleId);
    if (!module) return;

    try {
      await updateDoc(doc(db, 'modules', moduleId), {
        unlocked: !module.unlocked
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `modules/${moduleId}`);
    }
  };

  const getNextInterval = (card: Flashcard, quality: 'hard' | 'good' | 'great' | 'perfect'): number => {
    if (quality === 'hard') return 0;
    
    const currentInterval = card.interval || 0;
    
    if (quality === 'good') {
      if (currentInterval < 1) return 1;
      if (currentInterval < 3) return 3;
      if (currentInterval < 7) return 7;
      if (currentInterval < 30) return 30;
      return Math.ceil(currentInterval * 2);
    }
    
    if (quality === 'great') {
      if (currentInterval < 7) return 7;
      if (currentInterval < 30) return 30;
      if (currentInterval < 90) return 90;
      return Math.ceil(currentInterval * 2.5);
    }
    
    if (quality === 'perfect') {
      if (currentInterval < 30) return 30;
      if (currentInterval < 90) return 90;
      if (currentInterval < 180) return 180;
      if (currentInterval < 365) return 365;
      return Math.ceil(currentInterval * 3);
    }
    
    return 0;
  };

  const formatInterval = (days: number): string => {
    if (days === 0) return "Again";
    if (days === 1) return "1 day";
    if (days < 7) return `${days} days`;
    if (days === 7) return "1 week";
    if (days < 30) return `${Math.floor(days / 7)} weeks`;
    if (days === 30) return "1 month";
    if (days < 365) {
      const months = Math.floor(days / 30);
      return `${months} month${months > 1 ? 's' : ''}`;
    }
    if (days === 365) return "1 year";
    const years = Math.floor(days / 365);
    return `${years} year${years > 1 ? 's' : ''}`;
  };

  const handleSRSFeedback = async (quality: 'hard' | 'good' | 'great' | 'perfect') => {
    const card = studyQueue[currentCardIndex];
    if (!card || !user) return;

    const nextInterval = getNextInterval(card, quality);
    let nextEase = card.ease || 2.5;
    let nextReps = card.reps || 0;
    
    if (quality === 'hard') {
      nextReps = 0;
      nextEase = Math.max(1.3, nextEase - 0.2);
    } else {
      nextReps += 1;
      // Update ease based on quality
      if (quality === 'great') nextEase = Math.min(3.0, nextEase + 0.1);
      else if (quality === 'perfect') nextEase = Math.min(3.0, nextEase + 0.2);
    }

    const now = Date.now();
    const nextReviewDate = now + nextInterval * 24 * 60 * 60 * 1000;

    try {
      await updateDoc(doc(db, 'flashcards', card.id), {
        interval: nextInterval,
        nextReviewDate,
        reps: nextReps,
        ease: nextEase
      });

      if (quality === 'hard') {
        // Add to the end of the current study queue
        setStudyQueue(prev => [...prev, { ...card, nextReviewDate }]);
      }

      if (quality === 'hard' || currentCardIndex < studyQueue.length - 1) {
        setCurrentCardIndex(prev => prev + 1);
        setIsFlipped(false);
      } else {
        setIsStudyMode(false);
        setIsDueStudyMode(false);
        setActiveModule(null);
        setStudyQueue([]);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `flashcards/${card.id}`);
    }
  };

  const playAudio = async (text: string) => {
    if (isPlayingAudio || !text) return;
    setIsPlayingAudio(true);
    
    try {
      initAudioContext();
      const ctx = audioContextRef.current;
      if (!ctx) {
        throw new Error("AudioContext not initialized");
      }

      let audioData: ArrayBuffer;

      if (audioCacheRef.current[text]) {
        audioData = audioCacheRef.current[text].slice(0);
      } else {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        
        const fetchWithRetry = async (retries = 3, delay = 1000): Promise<any> => {
          try {
            return await ai.models.generateContent({
              model: "gemini-2.5-flash-preview-tts",
              contents: [{ parts: [{ text: `Read this English phrase naturally: ${text}` }] }],
              config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: 'Kore' },
                  },
                },
              },
            });
          } catch (error: any) {
            const errorMsg = error?.message || "";
            const isRateLimit = errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED') || error?.status === 429;
            
            if (retries > 0 && isRateLimit) {
              console.warn(`Rate limit hit for TTS, retrying in ${delay}ms... (${retries} retries left)`);
              await new Promise(resolve => setTimeout(resolve, delay));
              return fetchWithRetry(retries - 1, delay * 2);
            }
            throw error;
          }
        };

        const response = await fetchWithRetry();
        const part = response.candidates?.[0]?.content?.parts?.[0];
        const base64Audio = part?.inlineData?.data;

        if (!base64Audio) throw new Error("No audio data received");

        const binaryString = window.atob(base64Audio);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        audioData = bytes.buffer;
        audioCacheRef.current[text] = audioData.slice(0);
      }

      try {
        // Attempt 1: decodeAudioData (for standard formats like WAV/MP3)
        // We slice(0) to create a copy because decodeAudioData detaches the buffer
        const audioBuffer = await ctx.decodeAudioData(audioData.slice(0));
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        source.onended = () => setIsPlayingAudio(false);
        source.start();
      } catch (decodeError) {
        // Attempt 2: Manual PCM (for raw PCM data)
        console.log("decodeAudioData failed, falling back to manual PCM", decodeError);
        
        // Ensure we have an even number of bytes for 16-bit PCM
        const int16Data = new Int16Array(audioData, 0, Math.floor(audioData.byteLength / 2));
        const float32Data = new Float32Array(int16Data.length);
        for (let i = 0; i < int16Data.length; i++) {
          float32Data[i] = int16Data[i] / 32768.0;
        }
        
        const buffer = ctx.createBuffer(1, float32Data.length, 24000);
        buffer.getChannelData(0).set(float32Data);
        
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.onended = () => setIsPlayingAudio(false);
        source.start();
      }
    } catch (error) {
      console.error("Error generating audio:", error);
      setIsPlayingAudio(false);
    }
  };

  const generateFlashcards = async () => {
    if (!newModuleName || !newModuleContent || !user) return;
    
    setIsGenerating(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Crie exatamente 20 flashcards baseados no seguinte conteúdo de aula: "${newModuleContent}". 
        REGRAS CRÍTICAS:
        1. A FRENTE (front) deve conter uma frase ou pergunta exclusivamente em INGLÊS.
        2. O VERSO (back) deve conter a TRADUÇÃO exata para o PORTUGUÊS.
        3. The content should be focused on natural conversation and key concepts of the lesson.
        Retorne no formato JSON como uma lista de objetos com 'front' e 'back'.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                front: { type: Type.STRING, description: "A frase em INGLÊS" },
                back: { type: Type.STRING, description: "A tradução em PORTUGUÊS" }
              },
              required: ["front", "back"]
            }
          }
        }
      });

      const generatedCards = JSON.parse(response.text);
      const moduleId = crypto.randomUUID();
      
      const batch = writeBatch(db);
      
      const moduleRef = doc(db, 'modules', moduleId);
      batch.set(moduleRef, {
        id: moduleId,
        uid: user.uid,
        name: newModuleName,
        content: newModuleContent,
        cardCount: generatedCards.length,
        group: newModuleGroup,
        unlocked: false
      });

      generatedCards.forEach((card: any) => {
        const cardId = crypto.randomUUID();
        const cardRef = doc(db, 'flashcards', cardId);
        batch.set(cardRef, {
          id: cardId,
          uid: user.uid,
          front: card.front,
          back: card.back,
          moduleName: newModuleName,
          createdAt: Date.now(),
          nextReviewDate: Date.now(),
          interval: 0,
          reps: 0,
          ease: 2.5
        });
      });

      try {
        await batch.commit();
        setShowUploadModal(false);
        setNewModuleName('');
        setNewModuleContent('');
      } catch (commitError) {
        handleFirestoreError(commitError, OperationType.WRITE, 'batch-generate-flashcards');
      }
    } catch (error) {
      console.error("Error generating flashcards:", error);
      alert("An error occurred while generating flashcards. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  const deleteModule = async (id: string, name: string) => {
    if (!user) return;
    
    try {
      const moduleToDelete = modules.find(m => m.id === id);
      const cardsToDelete = flashcards.filter(c => c.moduleName === name);
      
      if (moduleToDelete) {
        setLastDeletedModule({ module: moduleToDelete, cards: cardsToDelete });
      }

      const batch = writeBatch(db);
      batch.delete(doc(db, 'modules', id));
      
      // Also delete associated flashcards
      const q = query(collection(db, 'flashcards'), where('moduleName', '==', name), where('uid', '==', user.uid));
      const snapshot = await getDocs(q);
      snapshot.forEach(d => batch.delete(d.ref));

      try {
        await batch.commit();
        if (activeModule === name) setActiveModule(null);
      } catch (commitError) {
        handleFirestoreError(commitError, OperationType.WRITE, 'batch-delete-module');
      }
    } catch (error) {
      console.error("Error deleting module:", error);
    }
  };

  const restoreLastDeleted = async () => {
    if (lastDeletedModule && user) {
      try {
        const batch = writeBatch(db);
        const moduleRef = doc(db, 'modules', lastDeletedModule.module.id);
        batch.set(moduleRef, { ...lastDeletedModule.module, uid: user.uid });

        lastDeletedModule.cards.forEach(card => {
          const cardRef = doc(db, 'flashcards', card.id);
          batch.set(cardRef, { ...card, uid: user.uid });
        });

        try {
          await batch.commit();
          setLastDeletedModule(null);
        } catch (commitError) {
          handleFirestoreError(commitError, OperationType.WRITE, 'batch-restore-module');
        }
      } catch (error) {
        console.error("Error restoring module:", error);
      }
    }
  };

  const openEditModal = (module: Module) => {
    setEditingModule(module);
    setNewModuleName(module.name);
    setNewModuleGroup(module.group);
    setNewModuleContent(module.content);
    setShowEditModal(true);
  };

  const saveEditModule = async () => {
    if (!editingModule || !newModuleName || !user) return;

    try {
      const batch = writeBatch(db);
      const moduleRef = doc(db, 'modules', editingModule.id);
      batch.update(moduleRef, {
        name: newModuleName,
        group: newModuleGroup,
        content: newModuleContent
      });

      // Update moduleName in flashcards if it changed
      if (newModuleName !== editingModule.name) {
        const q = query(collection(db, 'flashcards'), where('moduleName', '==', editingModule.name), where('uid', '==', user.uid));
        const snapshot = await getDocs(q);
        snapshot.forEach(d => batch.update(d.ref, { moduleName: newModuleName }));
      }

      try {
        await batch.commit();
        setShowEditModal(false);
        setEditingModule(null);
        setNewModuleName('');
        setNewModuleContent('');
      } catch (commitError) {
        handleFirestoreError(commitError, OperationType.WRITE, 'batch-save-edit-module');
      }
    } catch (error) {
      console.error("Error saving module edits:", error);
    }
  };

  const modulesByGroup = modules.reduce((acc, m) => {
    const group = m.group || 'Others';
    if (!acc[group]) acc[group] = [];
    acc[group].push(m);
    return acc;
  }, {} as Record<string, Module[]>);

  const now = Date.now();
  const dueCardsCount = flashcards.filter(card => {
    const module = modules.find(m => m.name === card.moduleName);
    return module?.unlocked && card.nextReviewDate <= now;
  }).slice(0, 20).length;

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0A0C10] text-[#E2E8F0] font-sans flex items-center justify-center p-6 relative overflow-hidden">
        {/* Decorative background element */}
        <div className="absolute top-0 right-0 -z-10 opacity-5 pointer-events-none">
          <svg width="600" height="800" viewBox="0 0 600 800" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M450 100C350 200 500 400 300 600C100 800 50 700 0 750" stroke="#D97706" strokeWidth="2" strokeDasharray="10 10" />
            <circle cx="450" cy="100" r="40" fill="#D97706" fillOpacity="0.2" />
          </svg>
        </div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-[#161B22] border border-[#30363D] rounded-3xl md:rounded-[2.5rem] p-6 md:p-10 shadow-2xl"
        >
          <div className="flex flex-col items-center text-center mb-8 md:mb-10">
            <div className="w-16 h-16 md:w-20 md:h-20 bg-amber-600 rounded-2xl md:rounded-3xl flex items-center justify-center shadow-lg shadow-amber-900/20 mb-4 md:mb-6 relative">
              <span className="text-3xl md:text-4xl">🐝</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-serif font-bold text-white mb-2">Welcome!</h1>
            <p className="text-sm md:text-gray-500 font-medium">Identify yourself to save your flashcard progress.</p>
          </div>

          <div className="space-y-4">
            <button 
              onClick={handleGoogleLogin}
              disabled={isLoggingIn}
              className="w-full bg-white hover:bg-gray-100 text-gray-900 py-3.5 md:py-4 rounded-xl md:rounded-2xl font-bold flex items-center justify-center gap-3 transition-all shadow-lg active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
            >
              {isLoggingIn ? (
                <div className="w-5 h-5 border-2 border-gray-900 border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path
                    fill="currentColor"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
              )}
              {isLoggingIn ? 'Logging in...' : 'Sign in with Google'}
            </button>
          </div>

          <div className="mt-10 pt-8 border-t border-[#1F2937] text-center">
            <p className="text-[10px] text-gray-600 font-bold uppercase tracking-widest leading-relaxed">
              Your progress will be saved automatically<br />to your Google account.
            </p>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0C10] text-[#E2E8F0] font-sans selection:bg-amber-500/30 relative overflow-hidden">
      {/* Decorative background element */}
      <div className="absolute top-0 right-0 -z-10 opacity-5 pointer-events-none">
        <svg width="600" height="800" viewBox="0 0 600 800" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M450 100C350 200 500 400 300 600C100 800 50 700 0 750" stroke="#D97706" strokeWidth="2" strokeDasharray="10 10" />
          <circle cx="450" cy="100" r="40" fill="#D97706" fillOpacity="0.2" />
        </svg>
      </div>

      {/* Header */}
      <header className="border-b border-[#1F2937] bg-[#0A0C10]/80 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 md:px-6 h-16 md:h-20 flex items-center justify-between">
          <div className="flex items-center gap-2 md:gap-3">
            <div className="w-8 h-8 md:w-10 md:h-10 bg-amber-600 rounded-full flex items-center justify-center shadow-lg shadow-amber-900/20 relative">
              <span className="text-xl md:text-2xl">🐝</span>
            </div>
            <h1 className="text-lg md:text-2xl font-serif font-bold tracking-tight text-white">beelinguall</h1>
          </div>
          <div className="flex items-center gap-2 md:gap-4">
            {user && (
              <div className="flex items-center gap-3 mr-2 md:mr-4 border-r border-[#1F2937] pr-2 md:pr-4">
                <div className="w-7 h-7 md:w-8 md:h-8 bg-amber-900/30 rounded-full flex items-center justify-center overflow-hidden">
                  {user.photoURL ? (
                    <img src={user.photoURL} alt={user.displayName || 'User'} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <User className="text-amber-500 w-3.5 h-3.5 md:w-4 md:h-4" />
                  )}
                </div>
                <div className="hidden sm:flex flex-col">
                  <span className="text-[8px] md:text-[10px] font-bold text-gray-500 uppercase tracking-widest">Student</span>
                  <span className="text-[10px] md:text-xs font-bold text-white truncate max-w-[100px]">{user.displayName || 'User'}</span>
                </div>
                <button 
                  onClick={handleLogout}
                  className="ml-1 md:ml-2 p-1 text-gray-500 hover:text-red-400 transition-colors"
                  title="Logout"
                >
                  <LogOut size={14} />
                </button>
              </div>
            )}
            <button 
              onClick={() => startStudy()}
              className="flex items-center gap-1.5 md:gap-2 bg-[#161B22] border border-[#30363D] hover:border-amber-500/50 text-white px-3 md:px-6 py-2 md:py-2.5 rounded-full text-xs md:text-sm font-semibold transition-all relative group"
            >
              <Sparkles size={16} className="text-amber-500 group-hover:scale-110 transition-transform" />
              <span className="hidden xs:inline">STUDY</span>
              {dueCardsCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 md:w-5 md:h-5 bg-amber-600 text-[8px] md:text-[10px] font-bold flex items-center justify-center rounded-full border-2 border-[#0A0C10] animate-pulse">
                  {dueCardsCount}
                </span>
              )}
            </button>
            <button 
              onClick={() => setShowAddLessonModal(true)}
              className="flex items-center gap-1.5 md:gap-2 bg-amber-600 hover:bg-amber-500 text-white px-3 md:px-6 py-2 md:py-2.5 rounded-full text-xs md:text-sm font-semibold transition-all shadow-md active:scale-95"
            >
              <Plus size={16} />
              <span className="hidden xs:inline">Add Lesson</span>
              <span className="xs:hidden">Add</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 md:px-6 py-8 md:py-12">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 md:py-40">
            <Loader2 className="w-10 h-10 md:w-12 md:h-12 text-amber-500 animate-spin mb-4" />
            <p className="text-gray-500 text-sm md:text-base font-medium animate-pulse">Loading your data...</p>
          </div>
        ) : !isStudyMode ? (
          <div className="space-y-8 md:space-y-12">
            {dueCardsCount > 0 && (
              <section className="bg-amber-900/10 border border-amber-900/30 rounded-3xl md:rounded-[2.5rem] p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="flex items-center gap-4 md:gap-6">
                  <div className="w-12 h-12 md:w-16 md:h-16 bg-amber-600 rounded-2xl flex items-center justify-center shadow-lg shadow-amber-900/40">
                    <Sparkles className="text-white w-6 h-6 md:w-8 md:h-8" />
                  </div>
                  <div>
                    <h2 className="text-xl md:text-2xl font-serif font-bold text-white">Time to Review!</h2>
                    <p className="text-amber-300/70 text-sm md:text-base font-medium">You have {dueCardsCount} cards waiting for you today.</p>
                  </div>
                </div>
                <button 
                  onClick={() => startStudy()}
                  className="w-full md:w-auto px-8 md:px-10 py-3 md:py-4 bg-amber-600 hover:bg-amber-500 text-white rounded-2xl font-bold uppercase text-xs md:text-sm tracking-widest transition-all shadow-lg shadow-amber-900/20 active:scale-95"
                >
                  Study Reviews
                </button>
              </section>
            )}

            <section>
              {modules.length === 0 ? (
                <div className="bg-[#161B22] border border-[#30363D] rounded-3xl md:rounded-[2rem] p-8 md:p-16 flex flex-col items-center text-center shadow-sm">
                  <div className="w-16 h-16 md:w-20 md:h-20 bg-amber-900/20 rounded-full flex items-center justify-center mb-6">
                    <BookOpen className="text-amber-500 w-8 h-8 md:w-10 md:h-10" />
                  </div>
                  <h3 className="text-xl md:text-2xl font-serif font-bold mb-3 text-white">No modules yet</h3>
                  <p className="text-gray-500 text-sm md:text-base max-w-sm mb-8 leading-relaxed">Upload your class content and let AI create your flashcards automatically.</p>
                  <button 
                    onClick={() => setShowAddLessonModal(true)}
                    className="bg-amber-600 text-white px-8 py-3 rounded-full font-bold hover:bg-amber-500 transition-all text-sm md:text-base"
                  >
                    Start now
                  </button>
                </div>
              ) : !selectedGroup ? (
                <div className="flex flex-col items-center justify-center py-12 md:py-20">
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="text-center mb-8 md:mb-12"
                  >
                    <h2 className="text-3xl md:text-5xl font-serif font-bold text-white mb-3 md:mb-4">Your Modules</h2>
                    <p className="text-gray-500 text-base md:text-lg">Select a module to start studying.</p>
                  </motion.div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 w-full max-w-3xl">
                    {Object.keys(modulesByGroup).map((group) => {
                      const groupDueCards = modulesByGroup[group].reduce((acc, m) => {
                        return acc + flashcards.filter(c => c.moduleName === m.name && c.nextReviewDate <= now).length;
                      }, 0);
                      return (
                        <motion.button
                          key={group}
                          whileHover={{ scale: 1.02, y: -5 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => setSelectedGroup(group)}
                          className="bg-[#161B22] border border-[#30363D] rounded-3xl md:rounded-[3rem] p-8 md:p-12 text-left hover:border-amber-500/50 transition-all group relative overflow-hidden"
                        >
                          <div className="absolute top-0 right-0 w-24 h-24 md:w-32 md:h-32 bg-amber-600/5 rounded-full -mr-12 -mt-12 md:-mr-16 md:-mt-16 group-hover:bg-amber-600/10 transition-colors" />
                          
                          {groupDueCards > 0 && (
                            <div className="absolute top-6 right-6 md:top-8 md:right-8 bg-amber-600 text-white text-[10px] md:text-xs font-bold px-3 md:px-4 py-1 md:py-1.5 rounded-full shadow-lg border-2 border-[#0A0C10] z-20 animate-pulse">
                              {groupDueCards} DUE
                            </div>
                          )}
                          
                          <div className="w-16 h-16 md:w-20 md:h-20 bg-amber-900/20 rounded-2xl md:rounded-[2rem] flex items-center justify-center mb-6 md:mb-8 group-hover:bg-amber-600 transition-colors relative z-10">
                            <BookOpen className="text-amber-500 group-hover:text-white w-8 h-8 md:w-10 md:h-10" />
                          </div>
                          
                          <h3 className="text-2xl md:text-4xl font-serif font-bold text-white mb-2 md:mb-3 relative z-10">{group === 'Outros' ? 'Others' : group}</h3>
                          <p className="text-gray-500 text-base md:text-lg font-medium relative z-10">{modulesByGroup[group].length} Lessons Available</p>
                          
                          <div className="mt-8 md:mt-10 flex items-center text-amber-500 font-bold uppercase text-xs md:text-sm tracking-[0.2em] relative z-10">
                            ACCESS MODULE <ChevronRight size={18} className="ml-2 group-hover:translate-x-2 transition-transform" />
                          </div>
                        </motion.button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="space-y-8">
                  <button 
                    onClick={() => setSelectedGroup(null)}
                    className="flex items-center gap-2 text-gray-500 hover:text-white font-bold uppercase text-xs tracking-widest transition-colors mb-4"
                  >
                    <ChevronLeft size={18} />
                    Back to Modules
                  </button>
                  
                  <div className="flex items-center gap-4 mb-8">
                    <div className="h-px flex-1 bg-amber-900/20"></div>
                    <h3 className="text-amber-500 font-bold uppercase tracking-[0.3em] text-xs">{selectedGroup}</h3>
                    <div className="h-px flex-1 bg-amber-900/20"></div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {modulesByGroup[selectedGroup].map((module) => {
                      const moduleDueCards = flashcards.filter(c => c.moduleName === module.name && c.nextReviewDate <= now).length;
                      return (
                        <motion.div 
                          layout
                          key={module.id}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          className={cn(
                            "group bg-[#161B22] border rounded-3xl md:rounded-[2rem] p-5 md:p-7 transition-all relative",
                            module.unlocked ? "border-[#30363D] hover:border-amber-500/50 cursor-pointer" : "border-gray-800 opacity-80"
                          )}
                          onClick={() => {
                            if (module.unlocked) {
                              initAudioContext();
                              startStudy(module.id);
                            }
                          }}
                        >
                          {module.unlocked && moduleDueCards > 0 && (
                            <div className="absolute -top-2 -right-2 bg-amber-600 text-white text-[10px] font-bold px-3 py-1 rounded-full shadow-lg border-2 border-[#0A0C10] z-10 animate-pulse">
                              {moduleDueCards} DUE
                            </div>
                          )}
                        <div className="flex justify-between items-start mb-4 md:mb-6">
                          <div className={cn(
                            "w-10 h-10 md:w-12 md:h-12 rounded-xl md:rounded-2xl flex items-center justify-center transition-colors",
                            module.unlocked ? "bg-amber-900/20 text-amber-500 group-hover:bg-amber-600 group-hover:text-white" : "bg-gray-800 text-gray-600"
                          )}>
                            {module.unlocked ? <BookOpen className="w-5 h-5 md:w-6 md:h-6" /> : <XCircle className="w-5 h-5 md:w-6 md:h-6" />}
                          </div>
                          <div className="flex gap-1 md:gap-2">
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleUnlockModule(module.id);
                              }}
                              className={cn(
                                "p-1.5 md:p-2 rounded-full transition-all",
                                module.unlocked ? "text-green-500 bg-green-900/10" : "text-gray-500 bg-gray-800 hover:text-green-400"
                              )}
                              title={module.unlocked ? "Mark as not done" : "Mark as done"}
                            >
                              <CheckCircle2 size={18} />
                            </button>
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                openEditModal(module);
                              }}
                              className="text-gray-600 hover:text-amber-400 p-1.5 md:p-2 transition-colors"
                              title="Edit Module"
                            >
                              <Edit2 size={18} />
                            </button>
                          </div>
                        </div>
                        <h3 className={cn(
                          "font-serif font-bold text-xl md:text-2xl mb-1 md:mb-2 transition-colors",
                          module.unlocked ? "text-white group-hover:text-amber-400" : "text-gray-600"
                        )}>{module.name}</h3>
                        <p className="text-xs md:text-sm text-gray-500 font-medium mb-4 md:mb-6">{module.cardCount} flashcards</p>
                        
                        {module.unlocked ? (
                          <div className="flex items-center text-amber-500 text-xs md:text-sm font-bold tracking-wide uppercase">
                            Study now
                            <ChevronRight size={16} className="ml-1 group-hover:translate-x-1 transition-transform" />
                          </div>
                        ) : (
                          <div className="flex items-center text-gray-600 text-xs md:text-sm font-bold tracking-wide uppercase italic">
                            Locked
                          </div>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
          </div>
        ) : (
          /* Study Mode */
          <div className="max-w-2xl mx-auto px-4 md:px-0">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 md:mb-10">
              <button 
                onClick={() => setIsStudyMode(false)}
                className="flex items-center gap-2 text-gray-500 hover:text-white font-bold uppercase text-[10px] md:text-xs tracking-widest transition-colors self-start"
              >
                <ChevronLeft size={16} />
                Exit Study
              </button>
              <div className="flex items-center justify-between md:justify-end gap-4 md:gap-6">
                <button 
                  onClick={() => setAutoAudio(!autoAudio)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-full text-[9px] md:text-[10px] font-bold uppercase tracking-widest transition-all border",
                    autoAudio ? "bg-amber-900/20 text-amber-400 border-amber-800/50" : "bg-[#161B22] text-gray-600 border-[#30363D]"
                  )}
                >
                  <Volume2 size={12} />
                  Auto Audio: {autoAudio ? "ON" : "OFF"}
                </button>
                
                <div className="flex flex-col items-end gap-1 md:gap-2">
                  <span className="text-[9px] md:text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                    Progress: {currentCardIndex + 1} of {studyQueue.length}
                  </span>
                  <div className="w-32 md:w-40 h-1 md:h-1.5 bg-[#1F2937] rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${((currentCardIndex + 1) / studyQueue.length) * 100}%` }}
                      className="h-full bg-amber-500" 
                    />
                  </div>
                </div>
              </div>
            </div>

            {studyQueue.length > 0 ? (
              <div className="space-y-6 md:space-y-10">
                <div 
                  className="relative h-[350px] md:h-[450px] w-full perspective-1000"
                >
                  <motion.div
                    className="w-full h-full relative preserve-3d"
                    animate={{ rotateY: isFlipped ? 180 : 0 }}
                    transition={{ type: "spring", stiffness: 150, damping: 20 }}
                  >
                    {/* Front */}
                    <div 
                      className="absolute inset-0 backface-hidden bg-[#161B22] border border-[#30363D] rounded-3xl md:rounded-[2.5rem] p-8 md:p-12 flex flex-col items-center justify-center text-center shadow-2xl shadow-black/40 cursor-pointer"
                      onClick={() => setIsFlipped(true)}
                    >
                      <span className="absolute top-6 left-8 md:top-8 md:left-10 text-[9px] md:text-[10px] uppercase tracking-[0.2em] font-bold text-amber-500/40">English</span>
                      
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          initAudioContext();
                          playAudio(studyQueue[currentCardIndex].front);
                        }}
                        className={cn(
                          "absolute top-6 right-8 md:top-8 md:right-10 p-2 md:p-3 rounded-full transition-all active:scale-90",
                          isPlayingAudio ? "bg-amber-900/40 text-amber-400" : "bg-[#0D1117] text-gray-500 hover:text-amber-400 hover:bg-amber-900/20"
                        )}
                      >
                        {isPlayingAudio ? <Loader2 size={16} className="animate-spin" /> : <Volume2 size={16} />}
                      </button>

                      <div className="text-xl md:text-3xl font-serif font-medium leading-tight text-white px-4">
                        <ReactMarkdown>{studyQueue[currentCardIndex].front}</ReactMarkdown>
                      </div>
                      <div className="absolute bottom-8 md:bottom-10 flex items-center gap-2 text-gray-600 text-[10px] md:text-xs font-bold uppercase tracking-widest">
                        <RotateCcw size={12} />
                        Click to see translation
                      </div>
                    </div>

                    {/* Back */}
                    <div 
                      className="absolute inset-0 backface-hidden bg-[#0D1117] border border-amber-900/30 rounded-3xl md:rounded-[2.5rem] p-8 md:p-12 flex flex-col items-center justify-center text-center shadow-2xl shadow-black/40 cursor-pointer"
                      style={{ transform: 'rotateY(180deg)' }}
                      onClick={() => setIsFlipped(false)}
                    >
                      <span className="absolute top-6 left-8 md:top-8 md:left-10 text-[9px] md:text-[10px] uppercase tracking-[0.2em] font-bold text-amber-500/40">Translation</span>
                      <div className="text-lg md:text-2xl font-serif leading-relaxed text-amber-400 px-4">
                        <ReactMarkdown>{studyQueue[currentCardIndex].back}</ReactMarkdown>
                      </div>
                    </div>
                  </motion.div>
                </div>

                <div className="flex flex-col gap-4 md:gap-6">
                  {isFlipped ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 w-full">
                      <button 
                        onClick={() => handleSRSFeedback('hard')}
                        className="flex flex-col items-center gap-0.5 md:gap-1 bg-[#161B22] border border-red-900/30 text-red-400 hover:bg-red-900/10 py-3 md:py-4 rounded-2xl font-bold transition-all active:scale-95"
                      >
                        <span className="text-[9px] md:text-xs uppercase tracking-widest opacity-60">Hard</span>
                        <span className="text-xs md:text-sm">{formatInterval(getNextInterval(studyQueue[currentCardIndex], 'hard'))}</span>
                      </button>
                      <button 
                        onClick={() => handleSRSFeedback('good')}
                        className="flex flex-col items-center gap-0.5 md:gap-1 bg-[#161B22] border border-orange-900/30 text-orange-400 hover:bg-orange-900/10 py-3 md:py-4 rounded-2xl font-bold transition-all active:scale-95"
                      >
                        <span className="text-[9px] md:text-xs uppercase tracking-widest opacity-60">Good</span>
                        <span className="text-xs md:text-sm">{formatInterval(getNextInterval(studyQueue[currentCardIndex], 'good'))}</span>
                      </button>
                      <button 
                        onClick={() => handleSRSFeedback('great')}
                        className="flex flex-col items-center gap-0.5 md:gap-1 bg-[#161B22] border border-green-900/30 text-green-400 hover:bg-green-900/10 py-3 md:py-4 rounded-2xl font-bold transition-all active:scale-95"
                      >
                        <span className="text-[9px] md:text-xs uppercase tracking-widest opacity-60">Great</span>
                        <span className="text-xs md:text-sm">{formatInterval(getNextInterval(studyQueue[currentCardIndex], 'great'))}</span>
                      </button>
                      <button 
                        onClick={() => handleSRSFeedback('perfect')}
                        className="flex flex-col items-center gap-0.5 md:gap-1 bg-amber-600 hover:bg-amber-500 text-white py-3 md:py-4 rounded-2xl font-bold transition-all active:scale-95 shadow-lg shadow-amber-900/20"
                      >
                        <span className="text-[9px] md:text-xs uppercase tracking-widest opacity-80">Perfect</span>
                        <span className="text-xs md:text-sm">{formatInterval(getNextInterval(studyQueue[currentCardIndex], 'perfect'))}</span>
                      </button>
                    </div>
                  ) : (
                    <button 
                      onClick={() => setIsFlipped(true)}
                      className="w-full bg-amber-600 hover:bg-amber-500 text-white py-4 md:py-5 rounded-2xl font-bold shadow-xl flex items-center justify-center gap-3 transition-all active:scale-95 text-sm md:text-base"
                    >
                      <RotateCcw size={20} />
                      Show Answer
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center py-20">
                <p className="font-serif text-2xl text-gray-500">No cards found.</p>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Add Lesson Modal */}
      <AnimatePresence>
        {showAddLessonModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddLessonModal(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-[#161B22] w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden border border-[#30363D]"
            >
              <div className="p-6 md:p-8">
                <div className="flex items-center gap-3 mb-6 md:mb-8">
                  <div className="w-10 h-10 md:w-12 md:h-12 bg-amber-900/30 rounded-xl md:rounded-2xl flex items-center justify-center">
                    <Plus className="text-amber-500 w-6 h-6 md:w-7 md:h-7" />
                  </div>
                  <div>
                    <h3 className="text-xl md:text-2xl font-serif font-bold text-white">Add Lesson</h3>
                    <p className="text-xs md:text-sm text-gray-500">Choose what you've already done in class to start studying.</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4 max-h-[350px] md:max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                  {LESSON_NAMES.map((lesson, index) => {
                    const isAlreadyAdded = modules.some(m => m.name === lesson);
                    return (
                      <button
                        key={lesson}
                        disabled={isAlreadyAdded || isAddingLesson !== null}
                        onClick={() => addSpecificLesson(index)}
                        className={cn(
                          "flex items-center justify-between p-4 md:p-5 rounded-xl md:rounded-2xl border transition-all text-left group",
                          isAlreadyAdded 
                            ? "bg-gray-900/50 border-gray-800 opacity-50 cursor-not-allowed" 
                            : "bg-[#0D1117] border-[#30363D] hover:border-amber-500/50 hover:bg-amber-900/5"
                        )}
                      >
                        <div className="flex items-center gap-3 md:gap-4">
                          <div className={cn(
                            "w-8 h-8 md:w-10 md:h-10 rounded-lg md:rounded-xl flex items-center justify-center font-bold text-[10px] md:text-xs",
                            isAlreadyAdded ? "bg-gray-800 text-gray-600" : "bg-amber-900/20 text-amber-500"
                          )}>
                            {isAddingLesson === index ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              index + 1
                            )}
                          </div>
                          <span className={cn(
                            "font-medium text-sm md:text-base",
                            isAlreadyAdded ? "text-gray-600" : "text-white group-hover:text-amber-400"
                          )}>{lesson}</span>
                        </div>
                        {isAlreadyAdded ? (
                          <CheckCircle2 size={16} className="text-green-500" />
                        ) : (
                          <ArrowRight size={16} className="text-gray-700 group-hover:text-amber-500 group-hover:translate-x-1 transition-all" />
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-6 md:mt-8 flex justify-end">
                  <button 
                    onClick={() => setShowAddLessonModal(false)}
                    className="px-6 md:px-8 py-2 md:py-3 rounded-xl font-bold text-gray-400 hover:bg-[#0D1117] transition-all text-sm"
                  >
                    Close
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Upload Modal */}
      <AnimatePresence>
        {showUploadModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !isGenerating && setShowUploadModal(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-[#161B22] w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden border border-[#30363D]"
            >
              <div className="p-6 md:p-8">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-amber-900/30 rounded-xl flex items-center justify-center">
                    <Sparkles className="text-amber-500 w-5 h-5 md:w-6 md:h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg md:text-xl font-bold text-white">Create New Module</h3>
                    <p className="text-xs md:text-sm text-gray-500">AI will generate 20 flashcards with audio.</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] md:text-xs font-bold uppercase tracking-wider text-gray-500 mb-1.5">Module (Group)</label>
                    <input 
                      type="text" 
                      placeholder="Ex: Module 1"
                      value={newModuleGroup}
                      onChange={(e) => setNewModuleGroup(e.target.value)}
                      className="w-full bg-[#0D1117] border border-[#30363D] text-white rounded-xl px-4 py-2.5 md:py-3 focus:outline-none focus:ring-2 focus:ring-amber-500 transition-all text-sm md:text-base"
                      disabled={isGenerating}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] md:text-xs font-bold uppercase tracking-wider text-gray-500 mb-1.5">Lesson Name</label>
                    <input 
                      type="text" 
                      placeholder="Ex: 1.1 Hello and Introductions"
                      value={newModuleName}
                      onChange={(e) => setNewModuleName(e.target.value)}
                      className="w-full bg-[#0D1117] border border-[#30363D] text-white rounded-xl px-4 py-2.5 md:py-3 focus:outline-none focus:ring-2 focus:ring-amber-500 transition-all text-sm md:text-base"
                      disabled={isGenerating}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] md:text-xs font-bold uppercase tracking-wider text-gray-500 mb-1.5">Class Content</label>
                    <textarea 
                      placeholder="Paste your class text or notes here..."
                      rows={5}
                      value={newModuleContent}
                      onChange={(e) => setNewModuleContent(e.target.value)}
                      className="w-full bg-[#0D1117] border border-[#30363D] text-white rounded-xl px-4 py-2.5 md:py-3 focus:outline-none focus:ring-2 focus:ring-amber-500 transition-all resize-none text-sm md:text-base"
                      disabled={isGenerating}
                    />
                  </div>
                </div>

                <div className="mt-6 md:mt-8 flex gap-3">
                  <button 
                    onClick={() => setShowUploadModal(false)}
                    className="flex-1 px-4 md:px-6 py-2.5 md:py-3 rounded-xl font-bold text-gray-400 hover:bg-[#0D1117] transition-all text-sm"
                    disabled={isGenerating}
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={generateFlashcards}
                    disabled={isGenerating || !newModuleName || !newModuleContent}
                    className="flex-[2] bg-amber-600 hover:bg-amber-500 disabled:bg-amber-800 text-white px-4 md:px-6 py-2.5 md:py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-amber-900/20 text-sm"
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="w-4 h-4 md:w-5 md:h-5 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Sparkles size={16} />
                        Generate 20 Cards
                      </>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Modal */}
      <AnimatePresence>
        {showEditModal && editingModule && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowEditModal(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-[#161B22] w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden border border-[#30363D]"
            >
              <div className="p-6 md:p-8">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-amber-900/30 rounded-xl flex items-center justify-center">
                    <Edit2 className="text-amber-500 w-5 h-5 md:w-6 md:h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg md:text-xl font-bold text-white">Edit Module</h3>
                    <p className="text-xs md:text-sm text-gray-500">Change the name or group of your module.</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] md:text-xs font-bold uppercase tracking-wider text-gray-500 mb-1.5">Module (Group)</label>
                    <input 
                      type="text" 
                      placeholder="Ex: Module 1"
                      value={newModuleGroup}
                      onChange={(e) => setNewModuleGroup(e.target.value)}
                      className="w-full bg-[#0D1117] border border-[#30363D] text-white rounded-xl px-4 py-2.5 md:py-3 focus:outline-none focus:ring-2 focus:ring-amber-500 transition-all text-sm md:text-base"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] md:text-xs font-bold uppercase tracking-wider text-gray-500 mb-1.5">Lesson Name</label>
                    <input 
                      type="text" 
                      placeholder="Ex: 1.1 Hello and Introductions"
                      value={newModuleName}
                      onChange={(e) => setNewModuleName(e.target.value)}
                      className="w-full bg-[#0D1117] border border-[#30363D] text-white rounded-xl px-4 py-2.5 md:py-3 focus:outline-none focus:ring-2 focus:ring-amber-500 transition-all text-sm md:text-base"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] md:text-xs font-bold uppercase tracking-wider text-gray-500 mb-1.5">Class Content</label>
                    <textarea 
                      placeholder="Paste your class text or notes here..."
                      rows={5}
                      value={newModuleContent}
                      onChange={(e) => setNewModuleContent(e.target.value)}
                      className="w-full bg-[#0D1117] border border-[#30363D] text-white rounded-xl px-4 py-2.5 md:py-3 focus:outline-none focus:ring-2 focus:ring-amber-500 transition-all resize-none text-sm md:text-base"
                    />
                  </div>
                </div>

                <div className="mt-6 md:mt-8 flex gap-3">
                  <button 
                    onClick={() => setShowEditModal(false)}
                    className="flex-1 px-4 md:px-6 py-2.5 md:py-3 rounded-xl font-bold text-gray-400 hover:bg-[#0D1117] transition-all text-sm"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={saveEditModule}
                    disabled={!newModuleName}
                    className="flex-[2] bg-amber-600 hover:bg-amber-500 disabled:bg-amber-800 text-white px-4 md:px-6 py-2.5 md:py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-amber-900/20 text-sm"
                  >
                    Save Changes
                  </button>
                </div>
                
                <div className="mt-4 md:mt-6 pt-4 md:pt-6 border-t border-[#30363D]">
                  <button 
                    onClick={() => {
                      if (confirm(`Are you sure you want to delete the module "${editingModule.name}"? This action can be undone immediately after.`)) {
                        deleteModule(editingModule.id, editingModule.name);
                        setShowEditModal(false);
                      }
                    }}
                    className="w-full flex items-center justify-center gap-2 text-red-500/60 hover:text-red-500 text-[10px] md:text-xs font-bold uppercase tracking-widest transition-colors"
                  >
                    <Trash2 size={14} />
                    Delete Module Permanently
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style>{`
        .perspective-1000 {
          perspective: 1000px;
        }
        .preserve-3d {
          transform-style: preserve-3d;
        }
        .backface-hidden {
          backface-visibility: hidden;
        }
      `}</style>
    </div>
  );
}
