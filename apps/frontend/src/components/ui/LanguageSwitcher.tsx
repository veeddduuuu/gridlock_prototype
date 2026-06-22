import { Globe } from 'lucide-react'
import React from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

export function LanguageSwitcher() {
  const { i18n } = useTranslation()

  const toggleLanguage = () => {
    const newLang = i18n.language === 'en' ? 'kn' : 'en'
    i18n.changeLanguage(newLang)
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggleLanguage}
      className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
    >
      <Globe size={16} />
      <span className="text-xs font-medium uppercase">
        {i18n.language === 'kn' ? 'ಕನ್ನಡ' : 'EN'}
      </span>
    </Button>
  )
}
